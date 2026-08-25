# TASK: Kontolista som larmar om konton saknas i en import

> **Status:** Designad 2026-08-24, reviderad 2026-08-25 efter granskning. Ej påbörjad.
> **Repo:** metaDB
> **Krav:** Importen får aldrig blockeras — datan som finns är alltid värd att ha.
> **Förutsättning:** Importspärren mot daglig nedbrytning är byggd
> (`assertNotDailyBreakdown` i `server/services/csvProcessor.js`, 2026-08-25) —
> se punkt 6 i Design nedan. Auto-rensningen i punkt 4 kan nu byggas.

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
**"komplettera senare"**. Granskningen 2026-08-25 lade till en tredje princip:
larmet får inte vara beroende av att någon faktiskt klickar något — se punkt 2
nedan.

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
- **Tröskel ≥4 av 6 senaste** som startvärde.
- **"Komplettera senare"** stänger bara rapportpanelen. Luckan är redan
  registrerad automatiskt av importen (se punkt 4 i Design) och rensas när en
  senare import fyller månaden — knappen skapar inget själv, den kvitterar bara
  att användaren sett larmet.

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

Samma Jaccard-gräns skyddar designen mot en enkonto-backfillfil (en riktad
om-export för att fylla en enskild lucka): en sådan fil överlappar historiken med
under 0,5 åt båda hållen och faller därför helt utanför `history`-fönstret — den
varken larmar falskt eller förorenar Jaccard-historiken. Se testfallet i
Verifiering.

### 2. Migration `011_account_roster.sql`

Följ `hidden_accounts` (`004_hidden_accounts.sql`), inte `p4Regions.js`: lösa
tabeller utan FK, `(account_name, platform)` som identitet, `datetime('now')`-
stämplar. **Ingen `CHECK` på status** — `006_allow_gsv_group_source.sql` visar vad
det kostar när värdemängden växer (full table-swap med FK-off utanför
transaktionen). Döpt `011` — `010` är tagen (`010_remove_tiktok.sql`).

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

CREATE TABLE IF NOT EXISTS import_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL,
  account_name TEXT NOT NULL,
  UNIQUE(import_id, account_name)
);
```

`account_roster` behöver ingen seedning — den fylls av importerna själva.
`account_gaps` seedas däremot med de 38 kända luckmånaderna ur
`TASK-saknade-exportmanader.md`: statiska `INSERT OR IGNORE`-rader, en per
(konto, plattform, månad), genererade från tabellen i den filen — de skrivs inte
ut här. Detta är medvetet skilt från heuristik-SQL:en som redan finns i den filen
för att *hitta nya* luckor; den körs inte mot livedata för seedningen, det ska
vara statiskt och auditbart. Utan seedningen visar kortet bara framtida luckor och
de tolv kända kontona syns fortsatt bara i TASK-filen, inte i appen.

`import_accounts` fylls i importtransaktionen (en rad per kontonamn i den
inkommande filen) och backfyllas i migrationen med
`SELECT DISTINCT import_id, account_name FROM posts`. Det är en accepterad
underrepresentation för äldre om-importer: sedan v2.22.0 behåller en post sitt
ursprungliga `import_id` vid UPSERT, så en om-imports fulla kontolista går inte
att rekonstruera ur `posts` i efterhand — bootstrap-raderna duger ändå som
startpunkt eftersom Jaccard-historiken (punkt 1) bara behöver ett sexmånaders-
fönster framåt från och med denna migration. Jaccard-historiken läser härifrån,
inte från `posts`.

**Håll begreppen isär från `hidden_accounts`.** Dolt betyder "jag vill inte se det
här" och gömmer även historiken. Avvecklat betyder "kontot finns inte längre" och
ska tvärtom behålla all historik, bara sluta larma. De hamnar troligen bredvid
varandra i UI:t och blandas annars lätt ihop.

### 3. Ren detekteringsmodul

`server/services/roster/missingAccounts.js` — ren funktion utan DB, testbar på
samma sätt som `spliceViewers.js`:

```js
findMissingAccounts({ importedNames, history, retired, openGapAccounts, window = 6, minSeen = 4 })
  → [{ account_name, seenIn, of, lastSeen, reason }]
```

`history` är `[{ month, names: Set }]` för samma plattform, redan Jaccard-filtrerad
av anroparen. Retirerade konton filtreras bort. `openGapAccounts` är ett `Set`
med konton som redan har en olöst rad (`resolved_at IS NULL`) i `account_gaps`
för plattformen — **Jaccard-scopat av anroparen på samma sätt som `history`**:
ta bara med konton vars olösta lucka har en ursprungsimport (`account_gaps.
import_id` → `import_accounts`) som överlappar den aktuella filen med ≥ 0,5.
Utan den filtreringen skulle en lokalt-import förlänga öppna luckor för
riks-konton (och omvänt) varje månad.

**Ovillkorlig spårning av öppna luckor.** Tröskeln ≥4/6 tystnar efter ungefär tre
månaders sammanhängande frånvaro — Kvällspasset och Naturmorgon var borta ett
halvår i sträck, så månad 4 och framåt av en sådan frånvaro föll under tröskeln
och registrerades aldrig. Ny regel: konton i `openGapAccounts` tas alltid med i
resultatet, oavsett `seenIn`/`of`, tills de återkommer i filen eller retireras.
Varje returnerad rad märks med `reason: 'threshold'` (fångad av 4/6-regeln) eller
`reason: 'open-gap'` (fångad för att luckan redan var öppen) — fältet är till för
telemetri/UI, ingenting filtreras bort på det.

### 4. Backend

`server/routes/imports.js:343-362` — utöka svaret **additivt** med
`stats.missingAccounts`. Formen är redan etablerad: sidoimportörerna returnerar
mjuka signaler (`skipped`, `netGrowthMismatches`) — det som saknas är att någon
renderar dem.

Rostern uppdateras i samma transaktion som importen (`imports.js:241-338`):
`INSERT OR IGNORE` per kontonamn i filen mot `account_roster`, plus samma rader
mot `import_accounts` (se Migration).

**Luckor registreras av importen, inte av knappen.** I samma transaktion:
`account_gaps` får `INSERT OR IGNORE` för varje konto som `findMissingAccounts`
flaggar, med `month = parsed.month` (fältet finns redan på `parsed`). Detta sker
oavsett vad användaren senare gör i rapportpanelen. Knapparna ändrar bara
`account_roster.status`: *Används inte längre* → `retired` (öppna luckor för
kontot döljs via join mot roster-status, raderas inte ur `account_gaps`);
*Komplettera senare* gör inget serveranrop alls — den stänger bara panelen,
luckan finns redan registrerad. En stängd panel utan klick lämnar luckan i exakt
samma tillstånd. Tyst dataförlust kan alltså inte längre bero på ett uteblivet
klick.

**Auto-rensning.** I samma transaktion, efter att posterna skrivits: för varje
`(account_name, month)` som faktiskt förekommer i den här importens poster,
`UPDATE account_gaps SET resolved_at = datetime('now') WHERE account_name = ?
AND platform = ? AND month = ? AND resolved_at IS NULL`. Se punkt 6 för varför
detta kräver att importspärren mot daglig nedbrytning finns på plats innan
auto-rensningen byggs.

Ny route `server/routes/accountRoster.js`, monterad som `/api/account-roster` i
`server/index.js`, i `hiddenAccounts.js`-stil (tunn, `{ accounts }`-svar, svenska
400-fel):

- `GET /` — rostern med status
- `POST /retire` — `{ accountName, platform }` → status `retired`
- `POST /reactivate` — tillbaka till `active`
- `GET /gaps` — öppna luckor. Ingen `POST /gaps`: `account_gaps` skrivs
  uteslutande av importtransaktionen (registrering och auto-rensning), aldrig
  via denna route.

### 5. Frontend

**Kritiskt:** `FileUploader.jsx:242-246` stänger sig själv 1,5 s efter lyckad
import (`setTimeout(onImportComplete, 1500)` när `succeeded > 0`). En varning där
hinner inte läsas. Villkora bort auto-stängningen när `missingAccounts` är
icke-tom.

Rapportpanelen visar per konto: namn, hur ofta det brukar finnas ("fanns i 11 av
17 senaste"), senast sedd, och två knappar — *Används inte längre* respektive
*Komplettera senare*. Historiken är det som gör larmet bedömbart på en sekund.
Panelen säger dessutom uttryckligen att inget måste antecknas eller göras direkt:
en rad i stil med *"Listan sparas automatiskt — du hittar den när som helst under
Importhantering → Öppna luckor."* (ordalydelsen får justeras till klarspråk,
budskapet ska stå fast).

Per-fil-statsen (`FileUploader.jsx:387-395`) behöver ingen ändring för detta.

I `ImportManager.jsx` en ny `<Card>` "Öppna luckor", direkt efter kortet
"Månadsöversikt" (rad 420-446) och före "Unika tittare (Facebook API)" (rad
448-479) — samma stil som de kringliggande korten. Kortet visar också en
exporthjälp-rad: exportera hela riks- eller lokaltgruppen, inte en enskild sida.
En enskild-sida-export gav 2026-08-24 dagsuppdelad videostatistik i stället för
en inläggsexport (se `TASK-saknade-exportmanader.md`), så att komplettera en
lucka via enskild sida riskerar att skapa exakt den typ av felaktig data som
`TASK-import-guard-daily-breakdown.md` är till för att stoppa.

### 6. Förutsättning: importspärren byggs först

`TASK-import-guard-daily-breakdown.md` måste vara klar **innan** auto-rensningen
i punkt 4 byggs. Skälet: kompletteringsvägen för en öppen lucka är ofta just en
enskild-sida-export, och det är precis där Meta levererar dagsuppdelade filer med
`views = 0` (se observationen i punkt 5). Utan spärren kan en sådan fil "lösa"
luckan tekniskt — `(konto, månad)` förekommer i importens poster, så
auto-rensningen stänger den — trots att datan är tyst felaktig, vilket är precis
det ursprungliga problemet den här uppgiften ska lösa. Byggordning: guard före
roster.

### 7. Filer

| Fil | Vad |
|---|---|
| `server/db/migrations/011_account_roster.sql` | ny — tre tabeller (`account_roster`, `account_gaps`, `import_accounts`) + seedning av de 38 kända luckorna |
| `server/services/roster/missingAccounts.js` + `.test.js` | ny — ren detektering, kontrakt inkl. `openGapAccounts`/`reason` |
| `server/services/accountRoster.js` | ny — CRUD + gap-registrering/auto-rensning i `hiddenAccounts.js`-stil |
| `server/routes/accountRoster.js` | ny — monteras i `server/index.js` |
| `server/routes/imports.js` | `stats.missingAccounts`, rosteruppdatering, `account_gaps`-registrering, auto-rensning, `import_accounts`-skrivning |
| `src/renderer/components/FileUploader/FileUploader.jsx` | rapportpanel (inkl. "sparas automatiskt"-raden), villkorad auto-stängning |
| `src/renderer/components/ImportManager/ImportManager.jsx` | Card "Öppna luckor" |
| `src/utils/apiClient.js` | roster-metoder |

### 8. Verifiering

- Enhetstester för `findMissingAccounts`: tom historik, konto som alltid funnits,
  konto under tröskeln, retirerat konto (larmar aldrig), och **konto borta flera
  månader i rad — måste fortfarande larma**, det var precis vad enmånadersregeln
  missade.
- **Enkonto-backfillfil** larmar inte falskt och förorenar inte
  Jaccard-historiken — Jaccard-överlappet mot en sådan fil ligger under 0,5 åt
  båda hållen (se punkt 1), så filen faller helt utanför `history`-fönstret.
  Låser designens nyckelegenskap.
- **Öppen lucka spåras även under tröskeln:** ett konto med en olöst rad i
  `account_gaps` registreras för nästa saknade månad även när `seenIn/of` faller
  under 4/6 (`reason: 'open-gap'`).
- **Öppen lucka läcker inte mellan scope:** en lokalt-import förlänger inte en
  öppen lucka vars ursprungsimport är en riks-fil (Jaccard-filtreringen av
  `openGapAccounts` i punkt 3).
- **Retirerat konto:** dess öppna luckor försvinner ur "Öppna luckor"-kortet
  (join mot `status = 'retired'`) men raderas inte ur `account_gaps`.
- **Auto-rensning är villkorad:** en lucka får `resolved_at` bara när importen
  faktiskt innehåller inlägg för (konto, månad) — en import utan det kontot
  lämnar luckan öppen.
- Regressionstest att `POST /api/imports` fungerar oförändrat utan roster-data.
- Skarpt: kör de 38 exportfilerna genom detekteringen och kontrollera att
  Naturmorgon nov-25, Kvällspasset jan-26, Radio Romano feb-26 och Vaken mar-26
  flaggas, och att ingen lokalstation flaggas i en riks-import.
- `npm test` (`node --test`, inte vitest). Baslinje 2026-08-24: 202 pass.

### 9. Risker

- **Varningströtthet.** ~4 larm per import i början. Ska sjunka när konton markeras
  som avvecklade. Gör det inte det är tröskeln fel — mät efter några månader.
- **Migration mot LIVE-databasen utan staging.** Backup före deploy enligt
  `CLAUDE.md`. Tre `CREATE TABLE IF NOT EXISTS` är dock lågrisk, ingen table-swap.
- **Kontonamnbyten** ser ut som ett försvunnet konto plus ett nytt. Känd risk i
  `CLAUDE.md`; rostern gör den synlig i stället för tyst, men löser den inte.
- **Byggordning.** Om auto-rensningen (punkt 4) byggs innan importspärren
  (punkt 6) finns risk att en dagsuppdelad enskild-sida-export stänger en lucka
  med felaktig data. Mildras genom att inte bygga i fel ordning.
- Första versionen bör vara Facebook och Instagram. TikTok Översikt är per
  definition dagsuppdelad och har egen importväg.

---

## Relaterat

- `TASK-saknade-exportmanader.md` — de tolv konton som redan drabbats, med
  åtgärdslista. De 38 kända luckmånaderna seedas in i `account_gaps` när den här
  uppgiften byggs (punkt 2 ovan), så listan blir synlig i appen i stället för att
  bara finnas i den filen.
- Spärren mot fel filtyp (tidigare `TASK-import-guard-daily-breakdown.md`) är
  byggd — `assertNotDailyBreakdown` i `server/services/csvProcessor.js`,
  2026-08-25. Var förutsättningen för den här uppgiften (punkt 6 ovan); nu
  uppfylld, auto-rensningen kan byggas.
