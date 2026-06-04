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
| Estimerade unika klickare (**service**) | **SERVER** | `server/services/estimatedUniqueClicks.js`, via `trends.js:234-275` (per månad) och `accounts.js` (period, `getEstimatedUniqueClicksByAccount`) | `F=sum_post_reach/account_reach; upper=clicks/F; lower=upper/1.5` |
| ~~Estimerade unika klickare (AccountView-tabell, inline)~~ | **BORTTAGEN** | ~~`accounts.js:172-206`~~ | ~~inline-reimpl. med `SUM(ar.reach)` per inlägg~~ — **åtgärdad**, se driftfynd #1 |
| Namnnormalisering (Comparison) | **SERVER** | `server/services/comparisonService.js:9-34` | strip `", Sveriges Radio"` + manuell karta |
| Zero-fill av tomma månader | **SERVER** (Fas 2) | `trends.js:resolveSeriesMonths` → `trend/series.js:fullMonthAxis`; `TrendAnalysisView` renderar serverns `months` (defensiva `??0` kvar) | full månadsaxel min→max **även utan** periodfilter — avsiktlig empty→0 (se öppen ändring nedan) |
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

## Driftfynd (det direktivet vill bort)

1. **Två implementationer av estimerade unika klickare som gav olika svar — ÅTGÄRDAT
   (avsiktlig bugfix, egen commit, separerad från refaktorn).**
   - `services/estimatedUniqueClicks.js` (korrekt): `F = sum_post_reach / account_reach`.
     Används av TrendAnalysisView via `trends.js`. För P4 Göteborg feb 2026:
     **F≈4.49, upper=24312, lower=16208, quality "ok"** (Fixture D).
   - `accounts.js:172-206` (avvikande inline, NU BORTTAGEN): joinade `SUM(ar.reach)`
     **per inlägg** → multiplicerade account_reach med antal inlägg → `F<1` → **allt
     suppressades** (0 av 64 konton hade estimat i AccountView-tabellen).
   - **Åtgärd:** AccountView går nu via servicen. Ny period-aggregerande funktion
     `getEstimatedUniqueClicksByAccount` summerar råkomponenter över månader med giltig
     kontoräckvidd och kör samma `computeEstimates`. Enmånadsperiod reproducerar exakt
     månadsvyns värde. Verifierat: AccountViews estimat för P4 Göteborg feb 2026 ==
     TrendAnalysisView-servicen (24312/16208/"ok"), `matchesServicePath: true`.
   - **AVSIKTLIG beteendeändring (tom → tal):** estimat-kolumnen gick från "suppressed
     för alla" till **52 ok / 4 uncertain / 8 suppressed** av 64. Detta är *inte* drift i
     no-drift-regelns mening (regeln fångar oavsiktlig drift när matte flyttas mellan
     lager, inte fredande av en felräknande dubblett). Baslinjen (`baseline.json`
     Fixture D2) ankrar nu de KORREKTA visade display-strängarna i alla tre render-
     grenar, så att AccountView-arbetet i Fas 2 (snitt/dag m.m.) blir en äkta no-op.

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
| **C** Trendserie med tom månad (periodfilter) | `/api/trends?metric=views&accountKeys=P4 DANS::facebook&months=2024-01…2026-05` | **2025-11 = 0** (server zero-fill via periodfilter), grannar 986992/236593 — oförändrad |
| **C2** Trendserie utan periodfilter (zero-fill) | `/api/trends?metric=views&accountKeys=P4 DANS::facebook` (inga months) | **AVSIKTLIG:** 2025-11 frånvarande → **0**; 28→29 mån, full axel 2024-01…2026-05 |
| **D** Uppsk. unika klickare (service-ankare) | `/api/trends?metric=estimated_unique_clicks` P4 Göteborg feb 2026 | **value 24312, lower 16208, quality "ok"** (F≈4.49) — får **inte** ändras |
| **D2** AccountView estimat-display (efter fix) | `/api/accounts?months=2026-02` | matchar servicen (`matchesServicePath: true`); display per gren: ok `~16 208 – 24 312`, uncertain `~12 045 – 18 068 ⚠`, suppressed `—`; fördelning 52 ok / 4 uncertain / 8 suppressed |
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
- **AccountView-estimatkolumnen: LÖST** i separat avsiktlig bugfix-commit (se driftfynd
  #1). AccountView använder nu servicen; baslinjen är omtagen mot de korrekta värdena.
  Återstående AccountView-arbete i Fas 2 (snitt/dag) är därmed en äkta no-op mot
  `baseline.json`. Enhetstest för `getEstimatedUniqueClicksByAccount` skrivs i Fas 1
  tillsammans med övriga service-tester.
- **Lågprio (guardrail-ankare):** F≈4.49 ligger nära varningströskeln F>5. Fixture D2
  ankrar nu en fixture i varje display-gren (ok/uncertain/suppressed) så att en framtida
  ändring inte tyst bryter guardrail-renderingen.

---

## Öppna frågor (beslut tas senare — rör inte i Fas 1)

**#1 — AccountView-estimatkolumnen.** LÖST, se driftfynd #1.

**#2 — `getEstimatedUniqueClicksByAccount` summerar `account_reach` över månader.**
`account_reach` är *unik* räckvidd per månad och är **icke-summerbar över tid**, på samma
sätt som cross-account ("Alla P4") räckvidd inte får summeras (jfr CLAUDE.md "Räckvidd =
alltid AVG, aldrig SUM"). Samma person nådd i flera månader dubbelräknas i nämnaren när
funktionen aggregerar en flermånaders-/custom-period → **nämnaren blåses upp → F
understryks → estimatet överskattas**. **Enmånadsperiod är exakt och oförändrad** (en
enda månads `account_reach`, ingen summering) — och det är den enda väg baslinjen
ankrar. Konsekvensen gäller endast vid flermånaders-/custom-period i AccountView-tabellen.
- Beslut senare: antingen (a) begränsa estimat-kolumnen till **månadsupplösning** (visa
  bara när exakt en månad är vald), eller (b) visa vid flermånad **med dokumenterad bias**
  (overestimate-flagga). 
- **Rör inte detta i Fas 1.** Loggat för spårbarhet; ingen kodändring nu.

---

## Avsiktliga beteendeändringar (skilda från no-op-refaktorn)

**A — AccountView estimat: tom → tal.** Se driftfynd #1. Egen commit.

**B — TrendAnalysisView zero-fill: frånvarande månad → 0-punkt (Fas 2).**
Tidigare byggde `trends.js` full månadsaxel **endast** när ett periodfilter fanns; utan
filter blev axeln bara månader med data → inre tomma månader var **frånvarande** ur
serien. Nu bygger `resolveSeriesMonths` → `trend/series.js:fullMonthAxis` en full
min→max-axel även utan filter, så tomma månader blir **explicita 0-punkter** (för
estimat: `null`, oförändrad suppress-semantik). Vecko-granularitet oförändrad.
- **Avsiktlig empty→0** (inte drift): en frånvarande månad i en linje ritas nu som en
  nedgång till 0 i stället för att hoppa över hålet. Ankrat i `baseline.json` **Fixture
  C2** (P4 DANS, utan filter: 2025-11 frånvarande → 0; 28→29 mån).
- **Periodfilter-fallet oförändrat** (Fixture C byte-identisk) och alla övriga
  fixtures/serier byte-identiska. TrendAnalysisView behövde **ingen** klientändring —
  den renderar redan serverns `months`-axel; de defensiva `??0`/`||0` är kvar (de är
  inte en dubblerad kalkyl, utan skyddar grupp-summe- och estimat-null-vägar).

---

## EXPORT_DESIGN — platt analysexport (Fas 3, v2.15.0)

`GET /api/export/flat` → `server/services/export/flatExport.js:buildFlatWorkbook()`.
Bygger UTESLUTANDE på serviceskiktet — ingen ny kalkyl. Flikar och deras källor:

| Flik | Grain | Service / källa (snitt via `dailyAverages.avgPerDay`, dagar = `daysInMonth(month)`) |
|---|---|---|
| `_LÄS_MIG` | — | README (klarspråk, FÖRST i boken) |
| `posts_monthly` | konto×mån | SQL `posts` + `hiddenPostsFilter`; avg_daily_link_clicks, posts_per_day via `dailyAverages` |
| `estimated_unique_clicks_monthly` | konto×mån | `getEstimatedUniqueClicks()` (per månad, inkl. uncertain/suppressed; kringgår öppen fråga #2) |
| `ga_listens_monthly` | konto×mån | SQL `ga_listens` + `hiddenGAFilter`; avg_daily_listens via `dailyAverages` |
| `ga_site_visits_monthly` | konto×mån | SQL `ga_site_visits` + `hiddenSiteVisitsFilter`; avg_daily_visits |
| `account_reach_monthly` | konto×mån | `account_reach` (FB, `hiddenReachFilter`) + `ig_account_reach` (IG, `hiddenIGReachFilter`) |
| `posts_groups_monthly` | grupp×mån | `getAccountGroups('posts')` + SBS-summering av posts_monthly; avg_daily_link_clicks (SBS) |
| `ga_listens_groups_monthly` | grupp×mån | `getAccountGroups('ga_listens')` + SBS av listens |
| `ga_site_visits_groups_monthly` | grupp×mån | `getAccountGroups('ga_site_visits')` + SBS av visits |
| `dim_accounts` | dim | distinct konto×plattform; `is_p4` via `p4Regions` |
| `dim_groups` | dim | `getAccountGroups()` |
| `dim_group_members` | dim | medlemskap (en rad per `group_id`×`account_name`) |

Regler: dolda konton exkluderade; endast verkliga rader (ingen zero-fill — exporten är
ett *dataval*, zero-fill var ett *chart*val); numeriska råvärden (ej display-strängar);
`month` (text) + `month_date` (äkta datum); räckvidd/posts_per_day/estimat UTESLUTNA
från grupp-flikar (icke-summerbara / GROUP_NON_SUMMABLE). Verifieras mot `baseline.json`
Fixtures A/D/E/F/G i `flatExport.baseline.test.js` (skippar utan snapshot).
