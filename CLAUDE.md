# CLAUDE.md — metaDB

## Projektöversikt

metaDB är en self-hosted analysapp som aggregerar data från Meta Business Suite (Facebook/Instagram), Meta Graph API och Google Analytics. Stack: Node.js/Express backend, React/Vite frontend, SQLite via better-sqlite3, custom SVG-charts + Chart.js (Plattformstrend).

## Språk

- Svenska i UI och commit-meddelanden.
- Engelska i variabelnamn, funktionsnamn och kodkommentarer.
- UI-copy ska vara klarspråk för icke-teknisk publik.

## Viktiga principer

### Data
- Lagra råvärden, beräkna vid hämtning. Snitt/dag-mätvärden beräknas alltid client-side.
- Sum-before-scale (SBS): vid gruppaggregeringar summera råvärden först, dela sedan. Aldrig medelvärde av medelvärden.
- Grupprad = display-only. Grupprader (_isGroup: true) exkluderas från totaler, exporter och paginering.
- Räckvidd = alltid AVG, aldrig SUM.
- Upsert-säker import. INSERT OR REPLACE + dedup "keep highest interactions".
- First-non-empty-wins för dual-language CSV-kolumner (SV+EN).
- Kontonamnbyten splittrar serier: UNIQUE går på account_name, så ett namnbyte i källan skapar en ny parallell serie. Fix = SQL-sammanslagning till senaste namnet + alias i importern (mönster: gaAccountAliases.js, Ekot 2026-07). **Känd risk:** IG-kontot @sverigesradiossymfoniorkester saknar visningsnamn hos Meta och ligger som handle i ig_account_reach (via ig_username-fallbacken, v2.21.1) — får kontot ett riktigt ig_name senare splittras serien och måste slås ihop/aliasas på samma sätt.
- FB "Unika tittare" (account_viewers) och legacy-reach (account_reach, fryst t.o.m. 2026-05) är OLIKA mått — slå aldrig ihop serierna. Importdetektering via Views_Source-kolumnen.

### Frontend
- Locale-medveten formatering: toLocaleString('sv-SE') för siffror, localeCompare('sv') för sortering.
- Hidden accounts filtreras i backend, inte frontend.
- Custom SVG-charts i TrendAnalysisView/ComparisonView. Chart.js enbart i PlatformTrendView.
- ProfileIcon (ui/ProfileIcon.jsx): färgkodad kanalbadge. size-prop: sm (24px) / md (36px).

### Backend
- Route-registreringsordning: specifika DELETE-routes före parametriserade routes.
- Migrationssystem: filer i server/db/migrations/ med prefix 001_, 002_, etc. Körs automatiskt vid start.
- Table-swap-migrationer (DROP + återskapa en FK-refererad tabell) MÅSTE köra med `foreign_keys` OFF satt UTANFÖR transaktionen — `PRAGMA foreign_keys` är en no-op inuti en transaktion, så annars utlöser DROP en ON DELETE CASCADE som tömmer barntabeller. Migrations-köraren (runMigrations i server/db/connection.js) togglar FK off→on runt varje migration och kör `foreign_key_check` efteråt.

## Deploy & DB-säkerhet

- Prod byggs från appdata-klonen på disk (`docker compose build` i stacken läser källkoden som ligger utcheckad där). Disken ska normalt stå på `main` — en oavsiktlig `build` plockar upp vad som än är utcheckat.
- Deploy kör migrationer mot LIVE-databasen vid start; det finns ingen staging. **Ta alltid en verifierad backup före en deploy som kan migrera.**
- Backup: online-backup via better-sqlite3 `db.backup()` (konsistent mot WAL) + `PRAGMA integrity_check`, lagra på två fysiska diskar. Volymägare är uid/gid 100:101.
- Behåll en känd-god rollback-image taggad separat (`docker tag … meta-analytics:rollback-pre-x`).
- Plattformsknappens antal = `SUM(imports.row_count)`, inte `COUNT(*)` posts — överräknar om-importer (UPSERT). Faktiskt antal unika inlägg finns i posts.

## Samarbete mellan Claude-instanser

- `git fetch`/pulla origin INNAN du börjar editera, så du baserar på den senast pushade koden från en parallell instans (slipper merge- och granskningsvarv).
- Endast en instans äger deploy åt gången: den som mergar till main äger ombyggnad + `compose up`. Den andra rör inte stacken förrän det är pushat — prod byggs från disk, så halvfärdig kod kan annars deployas.

## P4-regionsfilter

25 aktiva P4-lokalstationer definierade i shared/p4Regions.js. Matchning: account_name LIKE 'P4 {region}%'. Exkluderar: P4 DANS, P4 Dokumentär, P4 Extra, P4 Plus, P4 Södertälje.

## Tokeneffektivitet

- Upprepa aldrig uppgiftsbeskrivningen — gå direkt på lösningen.
- Förklara inte kod utan att bli ombedd.
- Visa bara diff vid redigeringar, inte hela filen.

## Commits

Engelska, imperativ form, max 72 tecken. Prefix: feat:, fix:, refactor:, docs:.
Committa aldrig: node_modules, .env, data/*.db, genererade filer.
