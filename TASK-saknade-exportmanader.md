# TASK: Konton som fallit ur Metas FB-exporter

> **Status:** Kartlagt 2026-08-24. Kräver om-export från Meta Business Suite, inte kodändring.
> **Repo:** metaDB

---

## Vad som hittats

Flera Facebook-konton saknar hela månader i databasen. Orsaken är **inte** importen —
kontona finns inte i de exportfiler som gjordes. Verifierat genom att läsa sidlistorna
i `FB Riks`- och `FB Lokalt`-filerna för respektive månad: kontot förekommer noll
gånger, trots att det har inlägg både före och efter och räckviddsdata för månaden.

Räckvidden finns eftersom den kommer från ett annat flöde (`account_reach`, Graph API),
vilket är just därför luckorna är osynliga i räckviddskurvorna men syns i
inläggsstatistiken.

## Åtgärdslista, störst först

Sorterad på ungefärlig datamängd som fattas. Räckvidden anger hur stor publik månaden
hade, alltså vad analysen missar.

| Konto | Månader | ~Inlägg/mån | Räckvidd i luckorna |
|---|---|---|---|
| **Kvällspasset i P4** | 2025-07, 2025-12, 2026-01…04, 2026-06 | 26 | ~3,5 mn |
| **Naturmorgon** | 2025-11…2026-04, 2026-06 | 23 | ~1,9 mn |
| **Trafikredaktionen P4 Stockholm** | 2024-07, 2024-12 | 13 | ~894 tn |
| **Vaken med P3 och P4** | 2026-03, 2026-04, 2026-06 | 34 | ~353 tn |
| **Nyheter från Sveriges Radio Ekot** | 2024-07, 2024-11, 2025-06…09 | 46 | ~328 tn |
| **Sveriges Radio P2** | 2024-05 | 55 | ~326 tn |
| **Klassisk morgon i P2** | 2026-01 | 23 | ~219 tn |
| **P4 DANS** | 2025-11 | 16 | ~212 tn |
| **Framåt Fredag** | 2024-02, 2024-03, 2025-08 | 10 | ~144 tn |
| **Radio Romano** | 2026-02 | 111 | ~129 tn |
| Livsåskådning i P1 | 2024-08 | 19 | — |
| Terni Generatcia | 2024-07, 2025-03, 2025-07, 2025-08, 2025-12 | 10 | ~1 tn |

**Klart 2026-08-25:** raderna ovan är seedade i `account_gaps` (migration
`011_account_roster.sql`, 38 statiska `INSERT OR IGNORE`-rader) och syns nu i
appen under Importhantering → Öppna luckor, med knapp för att avveckla
konton som inte längre används. Nya luckor upptäcks automatiskt av importen
(se kontolistlarmet — tidigare `TASK-account-roster.md`).

**P4 Extra 2025-11 är redan åtgärdat** (2026-08-24) och ingår inte i listan. Där var
orsaken en annan: kontot fanns i exporten men Meta lämnade Sidnamn, Sid-id och
Publiceringstid tomma för dess 111 rader. Appens permalänk-self-healing tillskrev
raderna rätt konto, men utan datum föll de utanför alla månadsvyer. Fixat med en
riktad `UPDATE` av `publish_time` från en ny export.

## Två skilda felmoder

1. **Kontot saknas helt i exporten** — den här listan. Åtgärd: lägg tillbaka sidan i
   exporturvalet och exportera om månaden.
2. **Kontot finns men fälten är tomma** — P4 Extra-fallet. Syns som rader utan
   `publish_time`. Kontrollera med:
   ```sql
   SELECT import_id, COUNT(*) FROM posts WHERE publish_time IS NULL GROUP BY import_id;
   ```
   Noll rader 2026-08-24.

## Rätt filtyp vid om-export

Meta kan ge en **daglig nedbrytning** i stället för en inläggsexport, och de ser nästan
likadana ut. Kontrollera före import:

- `Visningar`-kolumnen ska finnas. Saknas den är det fel typ.
- Antal unika `Publicerings-id` ska ungefär motsvara antal rader. Kvot ~0,04 betyder
  att varje inlägg upprepas en gång per dag.
- `Datum`-kolumnen finns i **båda** typerna och duger inte som skiljelinje.

Importen har en spärr mot detta sedan v2.25.0 (`assertNotDailyBreakdown` i
`server/services/csvProcessor.js`) — fel filtyp avvisas med klarspråksfel.

**Mekanismen klarlagd 2026-08-25 (Christians A/B-test):** den dagsuppdelade
filtypen styrs av **statistikläget i Metas exportdialog — "Daglig" kontra
"Livstid"**. Samma tre sidor, samma månad (april 2026): Daglig gav 26 kolumner
utan `Visningar` och 600 rader (20 inlägg × 30 dagar); Livstid gav 116 kolumner
med `Visningar` och 94 rader = 94 unika inlägg (kvot 1,0). Två tidigare
förklaringar hann vara fel på vägen: "enskild sida ger fel typ" (24/8, Radio
Romano) och "fel vy" (25/8) — sidurval och vy spelar ingen roll, det är
Daglig/Livstid-valet. **Vid om-export: välj Livstid.** Riktade småexporter är
att föredra för luckfyllnad: de lyfter inte övriga kontons befintliga inlägg
till dagens visningsnivåer (se "Not om om-import" nedan).

## Så här hittas luckorna igen

```sql
WITH pm AS (
  SELECT account_name, substr(publish_time,1,7) mon, COUNT(*) n
  FROM posts WHERE platform='facebook' AND publish_time IS NOT NULL GROUP BY 1,2),
span AS (SELECT account_name, MIN(mon) a, MAX(mon) b, ROUND(AVG(n)) snitt FROM pm GROUP BY 1),
axel AS (SELECT DISTINCT mon FROM pm)
SELECT s.account_name, axel.mon, CAST(s.snitt AS INT), ar.reach
FROM span s JOIN axel ON axel.mon > s.a AND axel.mon < s.b
LEFT JOIN pm ON pm.account_name=s.account_name AND pm.mon=axel.mon
LEFT JOIN account_reach ar ON ar.account_name=s.account_name AND ar.month=axel.mon
WHERE pm.n IS NULL AND s.snitt >= 10
ORDER BY s.snitt DESC, axel.mon;
```

Villkoret "har inlägg både före och efter" skiljer verkliga luckor från konton som
helt enkelt slutat publicera. Månader från 2026-06 och framåt saknar räckvidd att
jämföra med, eftersom `account_reach` är fryst t.o.m. 2026-05 — där är signalen
svagare.

## Not om om-import

Vid om-import gäller `INSERT OR REPLACE` på `post_id`. En färsk export har hunnit
samla på sig fler visningar än en gammal, så en om-import av en hel månad lyfter även
inlägg som redan finns till dagens nivå. Vill man bara fylla en lucka utan att röra
befintliga siffror: importera en fil som innehåller enbart det saknade kontot, eller
gör en riktad `UPDATE` som i P4 Extra-fallet. Ta alltid backup först
(`server2-03-services.md` §9).
