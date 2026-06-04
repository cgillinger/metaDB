# INVENTORY — Fas 0: var bor varje beräkning idag

Bekräftad inventering inför konsolidering av beräkningslogik till `server/services/`
(v2.14.0). Ingen kodändring i denna fas. Alla file:line-referenser avser repo-HEAD
`eb971d4` (app-version 2.13.3).

---

## Baslinjens datakälla

Den lokala `data/analytics.db` (480 KB) **duger inte** som regressionsunderlag:
inga P4-konton, och `account_reach`, `ga_listens`, `ga_site_visits` är tomma — alltså
inga fixtures för snitt/dag (GA), grupp-SBS eller uppskattade unika klickare.

Baslinjen är därför tagen mot en **konsistent snapshot av produktions-DB:n från
server2** (`ssh chris@192.168.50.8`, container `meta-analytics`, bind-mount
`/mnt/docker/appdata/meta-analytics/data/analytics.db`). Snapshot skapad med
`sqlite3 ".backup"` (WAL-säker), 194 MB, 289 862 inlägg 2023-09…2026-06, sparad i
`.baseline-prod/analytics.db` (gitignorerad, committas aldrig). Prod-schema =
`schema_version 7` = lokala migrationer `001…007` → ingen schemadrift.

**Körbarhetsnot (miljö):** harnessen reaper bakgrundsprocesser mellan verktygsanrop,
så en server kan inte hållas vid liv över anrop → Playwright mot live-app är opraktiskt
här. Baslinjen fångas istället på **API-nivå plus exakt replikering av klientformlerna**
(se `scripts/baseline/capture.mjs`). Eftersom formatering (sv-SE) lämnas oförändrad i
klienten är detta den exakta regressionsankaren som Fas 1/2 hävdar mot
("nya API-fält matchar baseline.json"). Server bootas + rivs i ett enda kommando via
`scripts/baseline/run-capture.sh`.

---

## Bekräftad inventering — var varje härlett mått räknas

| Mått | Sida | Plats (file:line) | Formel |
|---|---|---|---|
| `avg_daily_link_clicks` (konto) | **SERVER** | `server/routes/accounts.js:307,310` | `round((link_clicks/days)*10)/10` |
| `posts_per_day` (konto + total) | **SERVER** | `server/routes/accounts.js:308` | `round((post_count/days)*100)/100` |
| `avg_daily_link_clicks` (**grupprad**) | **KLIENT** | `AccountView.jsx:618-626` | SBS: `round((Σmember.link_clicks/totalPeriodDays)*10)/10` |
| `avg_daily_listens` (konto) | **SERVER** | `server/routes/gaListens.js:116-126` | `round((total_listens/Σdays)*10)/10` |
| `avg_daily_visits` (konto) | **SERVER** | `server/routes/gaSiteVisits.js:~125` | `round((total_visits/Σdays)*10)/10` |
| `avg_daily_*` (**grupprad**, GA) | **KLIENT** | `AccountView.jsx:463-491,534-562` | SBS: `Σmember.total / gaSummary.totalPeriodDays` |
| `avg_daily_*` (**trendserie**) | **KLIENT** | `TrendAnalysisView.jsx:446-459,576-584,693-701` | per månad: `round((value/daysInMonth(m))*10)/10` |
| `cadence` (posts/dag, kontodetalj) | **KLIENT** | `AccountDetailView.jsx:200-206` | `posts.length / periodDays` (fallback: span mellan första/sista inlägg) |
| `avg_views`, `avg_reach` (plattformstrend) | **SERVER** | `server/routes/platformTrends.js:70-84` | `ROUND(AVG(views/reach),0)` per månad |
| Barometer (rullande korttrend) | **KLIENT** | `PlatformTrendView.jsx:46-56` (`calcBarometer`, fönster=4) | `(recentAvg-prevAvg)/prevAvg` över `avg_views` |
| `calcYearOverYear` | **KLIENT** | `PlatformTrendView.jsx:62-79` | `(curr.avg_views - sameMonthLastYear.avg_views)/prev` |
| Kort-deltan (views/reach/posts vs förra mån) | **KLIENT** | `PlatformTrendView.jsx:215-228` | `(senaste-föregående)/föregående` |
| Estimerade unika klickare (**service**) | **SERVER** | `server/services/estimatedUniqueClicks.js:67-94`, via `trends.js:234-275` | `F=sum_post_reach/account_reach; upper=clicks/F; lower=upper/1.5` |
| Estimerade unika klickare (**AccountView-tabell**) | **SERVER (avvikande)** | `server/routes/accounts.js:172-206` | inline-reimpl. med `SUM(ar.reach)` per inlägg — **suppressar allt** |
| Namnnormalisering (Comparison) | **SERVER** | `server/services/comparisonService.js:9-34` | strip `", Sveriges Radio"` + manuell karta |
| Zero-fill av tomma månader | **DELAT** | `trends.js:39-56,372,379` (server) + `TrendAnalysisView.jsx:398,440,572` (`||0`/`??0`) | full månadsaxel via `buildMonthSpan` **endast** när periodfilter finns |
| Räckvidd | **SERVER (AVG, aldrig SUM)** | `account_reach`-väg, per månad | aldrig summerad/aggregerad |

`PostView` / `ComparisonView` / `ComparisonChart` gör **ingen** klientberäkning av mått —
de hämtar färdiga värden och presenterar.

---

## Svar på Fas 0-kontrollpunkterna

**1. Snitt/dag — förväntat klientsidigt → DELVIS MOTBEVISAT.**
Per **konto** beräknas `avg_daily_link_clicks`, `posts_per_day` (posts) och
`avg_daily_listens`/`avg_daily_visits` (GA) **server-side** (accounts.js / gaListens.js /
gaSiteVisits.js). CLAUDE.md:s "beräknas alltid client-side" stämmer alltså **inte** för
kontonivån idag. Klientsidig snitt/dag-beräkning lever kvar på två ställen:
(a) **grupprader/syntetiska rader** i AccountView (`:618-626` m.fl.) — **här bor
SBS-invarianten**, högsta prio att flytta; (b) **trendserier** i TrendAnalysisView
(`value/daysInMonth(m)` per månad). Dessa två klientvägar ger dessutom **olika
granularitet** (hel period vs per månad) än serverversionen → driftrisk.

**2. Plattformstrend korttrend + `calcYearOverYear` — BEKRÄFTAT klientsidigt.**
Båda i `PlatformTrendView.jsx` (`calcBarometer:46-56`, `calcYearOverYear:62-79`,
kort-deltan `215-228`), körda på `data.months` (`{month, post_count, avg_views,
avg_reach, account_count}` från platformTrends.js). Serverns enda matte här är
`AVG(views/reach)` per månad.

**3. Zero-fill — BEKRÄFTAT delat, med nyans.**
`trends.js:buildMonthSpan` (`39-56`) bygger full månadsaxel **endast** när `months`
eller `dateFrom/dateTo` finns; annars `months = Array.from(monthSet).sort()` (`:372`) =
bara månader som har rader → luckor saknas. Zero-fill sker via `|| 0` (`trends.js:379`)
och klientens `?? 0`/`|| 0` (`TrendAnalysisView.jsx:398,440,572`). **Det finns ingen
fullständig min/max-axel när periodfilter saknas** → `trend/series.js` ska bygga
axeln mellan min/max och fylla 0 för **alla** metrics (precis direktivets uppdrag).

**4. Comparison namnnormalisering — SERVER.**
`server/services/comparisonService.js:23-34` (`normalizeMetaName`) + manuell karta
(`:9-12`: "Nyheter från Sveriges Radio Ekot"→"Ekot", "SR Kultur"→"Kulturnytt").
Klienten normaliserar **inte**. ⇒ Fas 2 steg 4 (ComparisonView) blir sannolikt no-op.

**5. `posts_per_day` / "Alla P4" — BEKRÄFTAT omberäkning, ej SUM.**
`accounts.js:308` räknar `post_count/days` direkt från SUM-aggregatet `COUNT(*)`
(och `totals.post_count` = SUM över konton, `:106`). Grupprad "Alla P4" summeras
SBS-mässigt i klienten (`AccountView.jsx:618-626`): råvärden först, dela sedan.
Verifierat i baslinjen (Fixture E).

---

## Driftfynd (det direktivet vill bort) — flaggas för Fas 1-beslut

1. **Två implementationer av estimerade unika klickare som ger olika svar.**
   - `services/estimatedUniqueClicks.js` (korrekt): `F = sum_post_reach / account_reach`.
     Används av TrendAnalysisView via `trends.js`. För P4 Göteborg feb 2026:
     **F≈4.49, upper=24312, lower=16208, quality "ok"** (Fixture D).
   - `accounts.js:172-206` (avvikande inline): joinar `SUM(ar.reach)` **per inlägg**,
     vilket multiplicerar account_reach med antal inlägg → `F<1` → **allt suppressas**.
     Baslinje: **0 av 64** konton har icke-suppressed estimat i AccountView-tabellen
     (Fixture D2). Detta är sannolikt en latent bugg, men **ändras inte i Fas 0**.
   - Konsekvens för Fas 1: när AccountView-tabellen flyttas till samma service kommer
     dess estimat-kolumn att **ändra visat värde** (från tomt/suppressed till riktiga
     tal). Det bryter regeln "ingen fas avslutas med drift i en visad siffra" om det
     görs tyst. **Måste beslutas av direktivägaren** innan AccountView-vägen rörs.

2. **Snitt/dag finns på tre ställen** (server konto, klient grupprad, klient trendserie)
   med två olika granulariteter → exakt den dubbelräkning som ska konsolideras till
   `metrics/dailyAverages.js`.

3. **Namnskillnad mellan källor:** posts lagrar rått `"P4 Göteborg, Sveriges Radio"`,
   medan `ga_listens`/`ga_site_visits` lagrar normaliserat `"P4 Göteborg"`. Relevant för
   `period/resolve.js` och all cross-source-join (comparison normaliserar redan).

---

## Baslinje (`baseline.json`) — fångade fixtures

Mot prod-snapshot, fångade `scripts/baseline/capture.mjs`. Fas 1/2 måste reproducera
exakt.

| Fixture | Vad | Nyckelvärden |
|---|---|---|
| **A** snitt/dag, 2 konton × feb 2026 | `/api/accounts?months=2026-02` | P4 Göteborg: ppd **7.89**, snitt/dag länkklick **3898.5**; P4 Stockholm: ppd **7.29**, **1883.7** (Ekot saknar FB-inlägg i prod → byttes ut) |
| **B** Plattformstrend YoY (P4, FB) | `/api/platform-trends?platform=facebook&group=p4` | sista mån 2026-06 vs 2025-06: delta **−0.3503** (falling), 37836 vs 58232 |
| **C** Trendserie med tom månad | `/api/trends?metric=views&accountKeys=P4 DANS::facebook&months=2024-01…2026-05` | **2025-11 = 0** (zero-fill), grannar 2025-10=986992, 2025-12=236593 |
| **D** Uppsk. unika klickare (service-ankare) | `/api/trends?metric=estimated_unique_clicks` P4 Göteborg feb 2026 | **value 24312, lower 16208, quality "ok"** (F≈4.49) — får **inte** ändras |
| **D2** AccountView inline-divergens | `/api/accounts?months=2026-02` | GBG **suppressed**, **0/64** icke-suppressed (dokumenterad bugg) |
| **E** Grupp-SBS "Alla P4" feb 2026 | accounts + account-groups | 25/25 medlemmar, Σlänkklick 1518417 / 28 dgr → snitt/dag **54229.2** |

---

## Implikationer för Fas 1

- `metrics/dailyAverages.js`: ska äga både konto- och **grupp-SBS**-snitt/dag och ersätta
  AccountView.jsx:618-626 samt TrendAnalysisView per-månadsvägen. Återanvänd
  `dateHelpers.periodDays`/`daysInMonth`.
- `trend/barometer.js`: lyft `calcBarometer` + `calcYearOverYear` ordagrant från
  PlatformTrendView (fönster 4 default).
- `trend/series.js`: bygg full månadsaxel mellan min/max när periodfilter saknas
  (täcker luckan i nuvarande `buildMonthSpan`).
- `period/resolve.js`: ena `months` vs `dateFrom/dateTo`; dokumentera upplösning per
  källa (posts: dag; account_reach: månad; GA: månad).
- **Öppen fråga (blockerar AccountView-estimatkolumnen):** ska AccountView byta till
  service-vägen (och därmed börja visa riktiga estimat istället för tomt)? Det är en
  *avsiktlig* beteendeändring och måste godkännas — annars bryts baslinjeregeln.
