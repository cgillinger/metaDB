# TASK: Kontolista som larmar om konton saknas i en import

> **Status:** Designad och mätt 2026-08-24. Ej påbörjad.
> **Repo:** metaDB
> **Krav:** Importen får aldrig blockeras — datan som finns är alltid värd att ha.

---

## Problemet

Metas exportfiler tappar konton tyst. Kartläggningen i
`TASK-saknade-exportmanader.md` hittade tolv Facebook-konton som saknar
sammanlagt 38 månader — Kvällspasset i P4 med ~3,5 miljoner i räckvidd,
Naturmorgon med ~1,9 miljoner. **Ingenting i appen märkte det.** Luckorna
upptäcktes först när någon råkade titta på en enskild kurva, månader efteråt.

Räckvidden finns kvar i de månaderna, eftersom den hämtas via Graph API och inte
via CSV. Därför ser räckviddskurvorna hela ut medan inläggsstatistiken har hål —
vilket är precis varför problemet kunnat ligga oupptäckt så länge.

Målet: importen säger själv ifrån — *"tre konton som brukar finnas med saknas i
den här filen"* — och användaren svarar antingen **"används inte längre"** eller
**"komplettera senare"**.

## Mätdata som styr designen

Simulerat mot 38 verkliga exportfiler (FB Riks + FB Lokalt, jan 2025 – jul 2026):

| Regel | Larm per import | Kända fall fångade |
|---|---|---|
| Bara mot förra månadens fil | ~3 | **5 av 10** |
| Fanns i ≥4 av 6 senaste | ~4,1 | **9 av 10** |
| Fanns i ≥5 av 6 senaste | ~3 | 6 av 10 |

**Varför enmånadersregeln inte räcker:** saknas ett konto flera månader i rad finns
det inte i förra månaden heller, så ingen ny varning utlöses. Naturmorgon och
Kvällspasset försvann båda ett halvår i sträck och hade tystnat efter första
månaden.

**Bruset är verkligt och måste designas för.** Bara 26 av 55 riks-konton finns med
i alla 17 månaderna. P4 Dokumentär växlar in och ut 7 gånger, Kvällspasset 6.
Därför måste varningen bära historik och gå att kvittera permanent — annars slutar
man läsa den efter tredje månaden.

## Beslutat med Christian 2026-08-24

- **Icke-blockerande.** Filen importeras direkt, rapporten visas efteråt.
- **"Komplettera senare"** skapar en lista över öppna luckor i appen, som rensas
  automatiskt när en senare import fyller månaden.
- **Tröskel ≥4 av 6 senaste** som startvärde.

---

## Design

### 1. Scope-detektering utan etiketter

Problemet: en FB Riks-fil får inte larma om alla lokalstationer.

Lösningen kräver ingen riks/lokalt-kunskap. Hitta de sex senaste importerna av
samma plattform vars kontolista överlappar filens med **Jaccard ≥ 0,5**, och räkna
förekomster i just dem.

Verifierat mot samtliga 38 filer: **noll förväxlingar** mellan riks och lokalt,
9 av 10 kända fall fångade. Detta undviker att koda in en exportgruppsindelning
som Meta ändå ändrar på egen hand — filnamnsprefix duger inte, 166 konton hamnar
utanför det mönstret.

### 2. Migration `010_account_roster.sql`

Följ `hidden_accounts` (`004_hidden_accounts.sql`), inte `p4Regions.js`: lös tabell
utan FK, `(account_name, platform)` som identitet, `datetime('now')`-stämplar.
**Ingen `CHECK` på status** — `006_allow_gsv_group_source.sql` visar vad det kostar
när värdemängden växer (full table-swap med FK-off utanför transaktionen).

```sql
CREATE TABLE IF NOT EXISTS account_roster (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'retired'
  retired_at TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(account_name, platform)
);

CREATE TABLE IF NOT EXISTS account_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  month TEXT NOT NULL,
  import_id INTEGER,
  noticed_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE(account_name, platform, month)
);
```

Rostern behöver ingen seedning — den fylls av importerna själva.

**Håll begreppen isär från `hidden_accounts`.** Dolt betyder "jag vill inte se det
här" och gömmer även historiken. Avvecklat betyder "kontot finns inte längre" och
ska tvärtom behålla all historik, bara sluta larma. De hamnar troligen bredvid
varandra i UI:t och blandas annars lätt ihop.

### 3. Ren detekteringsmodul

`server/services/roster/missingAccounts.js` — ren funktion utan DB, testbar på
samma sätt som `spliceViewers.js`:

```js
findMissingAccounts({ importedNames, history, retired, window = 6, minSeen = 4 })
  → [{ account_name, seenIn, of, lastSeen }]
```

`history` är `[{ month, names: Set }]` för samma plattform, redan Jaccard-filtrerad
av anroparen. Retirerade konton filtreras bort.

### 4. Backend

`server/routes/imports.js:436-444` — utöka svaret **additivt** med
`stats.missingAccounts`. Formen är redan etablerad: sidoimportörerna returnerar
mjuka signaler (`skipped`, `netGrowthMismatches`) — det som saknas är att någon
renderar dem.

Rostern uppdateras i samma transaktion som importen (`imports.js:324-421`):
`INSERT OR IGNORE` per kontonamn i filen.

Ny route `server/routes/accountRoster.js`, monterad som `/api/account-roster` i
`server/index.js`, i `hiddenAccounts.js`-stil (tunn, `{ accounts }`-svar, svenska
400-fel):

- `GET /` — rostern med status
- `POST /retire` — `{ accountName, platform }` → status `retired`
- `POST /reactivate` — tillbaka till `active`
- `GET /gaps` / `POST /gaps` — öppna luckor

### 5. Frontend

**Kritiskt:** `FileUploader.jsx:418-422` stänger sig själv 1,5 s efter lyckad
import. En varning där hinner inte läsas. Villkora bort auto-stängningen när
`missingAccounts` är icke-tom.

Rapportpanelen visar per konto: namn, hur ofta det brukar finnas ("fanns i 11 av
17 senaste"), senast sedd, och två knappar — *Används inte längre* respektive
*Komplettera senare*. Historiken är det som gör larmet bedömbart på en sekund.

I `ImportManager.jsx` en ny `<Card>` för öppna luckor, mellan rad 449 och 452, i
samma stil som korten för "Unika tittare" och "Kontoräckvidd". Det ger arbetslistan
som annars skrivs för hand i TASK-filer.

### 6. Filer

| Fil | Vad |
|---|---|
| `server/db/migrations/010_account_roster.sql` | ny — två tabeller |
| `server/services/roster/missingAccounts.js` + `.test.js` | ny — ren detektering |
| `server/services/accountRoster.js` | ny — CRUD i `hiddenAccounts.js`-stil |
| `server/routes/accountRoster.js` | ny — monteras i `server/index.js` |
| `server/routes/imports.js` | `stats.missingAccounts` + rosteruppdatering |
| `src/renderer/components/FileUploader/FileUploader.jsx` | rapportpanel, villkorad auto-stängning |
| `src/renderer/components/ImportManager/ImportManager.jsx` | Card för öppna luckor |
| `src/utils/apiClient.js` | roster-metoder |

### 7. Verifiering

- Enhetstester för `findMissingAccounts`: tom historik, konto som alltid funnits,
  konto under tröskeln, retirerat konto (larmar aldrig), och **konto borta flera
  månader i rad — måste fortfarande larma**, det var precis vad enmånadersregeln
  missade.
- Regressionstest att `POST /api/imports` fungerar oförändrat utan roster-data.
- Skarpt: kör de 38 exportfilerna genom detekteringen och kontrollera att
  Naturmorgon nov-25, Kvällspasset jan-26, Radio Romano feb-26 och Vaken mar-26
  flaggas, och att ingen lokalstation flaggas i en riks-import.
- `npm test` (`node --test`, inte vitest). Baslinje 2026-08-24: 202 pass.

### 8. Risker

- **Varningströtthet.** ~4 larm per import i början. Ska sjunka när konton markeras
  som avvecklade. Gör det inte det är tröskeln fel — mät efter några månader.
- **Migration mot LIVE-databas utan staging.** Backup före deploy enligt
  `CLAUDE.md`. Två `CREATE TABLE IF NOT EXISTS` är dock lågrisk, ingen table-swap.
- **Kontonamnbyten** ser ut som ett försvunnet konto plus ett nytt. Känd risk i
  `CLAUDE.md`; rostern gör den synlig i stället för tyst, men löser den inte.
- Första versionen bör vara Facebook och Instagram. TikTok Översikt är per
  definition dagsuppdelad och har egen importväg.

---

## Relaterat

- `TASK-saknade-exportmanader.md` — de tolv konton som redan drabbats, med
  åtgärdslista. Rostern hade fångat dem när de uppstod.
- `TASK-import-guard-daily-breakdown.md` — spärr mot fel filtyp. Fristående, men
  båda handlar om att importen ska säga ifrån i stället för att tiga.
