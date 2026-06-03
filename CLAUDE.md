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

### Frontend
- Locale-medveten formatering: toLocaleString('sv-SE') för siffror, localeCompare('sv') för sortering.
- Hidden accounts filtreras i backend, inte frontend.
- Custom SVG-charts i TrendAnalysisView/ComparisonView. Chart.js enbart i PlatformTrendView.
- ProfileIcon (ui/ProfileIcon.jsx): färgkodad kanalbadge. size-prop: sm (24px) / md (36px).

### Backend
- Route-registreringsordning: specifika DELETE-routes före parametriserade routes.
- Migrationssystem: filer i server/db/migrations/ med prefix 001_, 002_, etc. Körs automatiskt vid start.

## P4-regionsfilter

25 aktiva P4-lokalstationer definierade i shared/p4Regions.js. Matchning: account_name LIKE 'P4 {region}%'. Exkluderar: P4 DANS, P4 Dokumentär, P4 Extra, P4 Plus, P4 Södertälje.

## Tokeneffektivitet

- Upprepa aldrig uppgiftsbeskrivningen — gå direkt på lösningen.
- Förklara inte kod utan att bli ombedd.
- Visa bara diff vid redigeringar, inte hela filen.

## Commits

Engelska, imperativ form, max 72 tecken. Prefix: feat:, fix:, refactor:, docs:.
Committa aldrig: node_modules, .env, data/*.db, genererade filer.
