# CLAUDE.md — metaDB

## Projektöversikt

metaDB är en self-hosted analysapp som aggregerar data från Meta Business Suite (Facebook/Instagram), Meta Graph API och Google Analytics. Stack: Node.js/Express backend, React/Vite frontend, SQLite via better-sqlite3, custom SVG-charts + Chart.js (Plattformstrend).

## Öppna uppgifter

Uppskjutet arbete ligger i `TASK-*.md` i repo-roten. **Läs dem innan du tar dig an
importvägen eller säkerheten** — de innehåller färdig analys som annars görs om.

- `TASK-saknade-exportmanader.md` — tolv FB-konton saknar hela månader i databasen
  (Kvällspasset ~3,5 mn räckvidd, Naturmorgon ~1,9 mn m.fl.). Kontona finns inte i
  Metas exportfiler för de månaderna — kräver om-export, inte kodändring. Innehåller
  åtgärdslista och SQL för att hitta luckorna igen.
- `TASK-account-roster.md` — kontolista som larmar när konton saknas i en import,
  med val "används inte längre" / "komplettera senare". Designad och mätt mot 38
  verkliga exportfiler; fångar 9 av 10 kända luckor. Hade fångat de tolv i
  `TASK-saknade-exportmanader.md` när de uppstod.
- `TASK-security-hardening.md` — femfasig säkerhetshärdning.

Ta bort TASK-filen när uppgiften är gjord (jfr commit 43cf9ff).

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
  - **Undantag (v2.23.0):** trendmåttet `account_viewers_spliced` ritar en visuellt skarvad linje av **råvärden** med provenance per månad (`source`: legacy/viewers, `ghost`: äldre måttet under överlappet) och en "Måttbyte"-markering. Värdena slås aldrig ihop, skalas aldrig och aggregeras aldrig — måttet är avstängt för kontogrupper (NON_SUMMABLE_METRICS) och År-över-år, och finns inte i exporter. Logiken ligger i `server/services/trend/spliceViewers.js`. Ta inte bort det som en "fix" av regeln ovan.
  - Uppmätt nivåskillnad maj 2026 (68 konton, enda överlappsmånaden): median viewers/reach = 0,99, totalt −1,9 %, spridning per konto 0,34–1,56. Serien duger för form över tid, inte för procenträkning tvärs brytpunkten.
  - Viewers kan backfyllas till 2024-06 (FBFetch-probe 2026-07-01, `page_total_media_view_unique`, API v25.0). `fetch_viewers.py --facebook --month --year-month YYYY-MM`, en månad per körning. Sedan v2.23.4 tål skarvlogiken icke-sammanhängande backfill (legacy bär linjen fram till den avslutande viewers-sviten), så körordningen spelar ingen roll.

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
- **Kod och stack ligger i SKILDA kataloger på server2.** Kör aldrig `docker compose` i kodkatalogen — repots `docker-compose.yml` är enbart för lokal dev och publicerar `127.0.0.1:3001`. Prod-stacken publicerar `51517:3001`, och det är port 51517 som Tailscale-ACL:n släpper igenom. Deployar man från fel katalog byter containern port och blir onåbar både i LAN och via Tailscale (hände 2026-08-24). Rätt sekvens:
  ```bash
  cd /mnt/docker/appdata/meta-analytics && git pull       # kod
  cd /mnt/docker/stacks/meta-analytics && docker compose build
  chown -R 100:101 /mnt/docker/appdata/meta-analytics/data/
  docker compose up -d                                    # från stack-katalogen
  ```
- Åtkomst: LAN via `192.168.50.8:51517`, fjärr via Tailscale. Inget är WAN-exponerat (ingen portforward, ingen UPnP) — se `server2-docs/server2-09-network-security.md`. `ADMIN_TOKEN` är medvetet inte satt; LAN + Tailscale-ACL bedöms tillräckligt.
- Deploy kör migrationer mot LIVE-databasen vid start; det finns ingen staging. **Ta alltid en verifierad backup före en deploy som kan migrera.**
- Backup: online-backup via better-sqlite3 `db.backup()` (konsistent mot WAL) + `PRAGMA integrity_check`, lagra på två fysiska diskar. Volymägare är uid/gid 100:101.
- Behåll en känd-god rollback-image taggad separat (`docker tag … meta-analytics:rollback-pre-x`).
- **Städa gamla deploy-backuper:** ad hoc-backuper från deploydagar ska rensas när releasen bevisat sig (fråga Christian först). Ordinarie Kopia/btrbk täcker ändå. Rensat 2026-08-24 (~2,7 GB): allt från mars–juli utom den senast föregående releasen. Behåll som tumregel de två färskaste plus föregående release, på båda diskarna.
- **Lägg aldrig backuper i `data/`.** Katalogen bind-monteras som `/sources/meta-analytics-data:ro` i Kopia, så varje kopia där backas upp till pCloud dagligen. Ad hoc-backuper hör hemma i `/home/chris/` + `/mnt/storage3tb/meta-analytics-db/`. Åtta sådana kopior (1,7 GB) låg felplacerade i `data/` fram till 2026-08-24.
- Plattformsknappens antal = `SUM(imports.row_count)`, inte `COUNT(*)` posts. Sedan v2.22.0 behåller inlägg sitt ursprungliga `import_id` vid UPSERT (om-importer får row_count = enbart nya rader, och DELETE på en om-import raderar inte historik) — äldre om-importer kan dock fortfarande vara överräknade i summan. Faktiskt antal unika inlägg finns i posts.

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
