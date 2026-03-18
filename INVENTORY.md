# Inventering – Facebook & Instagram CSV-analysappar

> Fas 1 av sammanslagningsplanen. Inga kodändringar görs här – enbart observation.

---

## 1. Dependencies

Båda apparna har **identiska** dependencies och devDependencies:

| Paket | Version | Syfte |
|---|---|---|
| react + react-dom | ^18.2.0 | UI-ramverk |
| papaparse | ^5.4.1 | CSV-parsning |
| xlsx | ^0.18.5 | Excel-export |
| lucide-react | ^0.263.1 | Ikoner |
| @radix-ui/* (6 paket) | ^1–2.x | shadcn/ui-primitiver |
| class-variance-authority | ^0.7.0 | Tailwind-varianter |
| clsx + tailwind-merge | ^2.x | CSS-verktyg |
| vite + @vitejs/plugin-react | ^5 / ^4.2 | Bygge |
| tailwindcss | ^3.4.0 | Styling |
| gh-pages | ^6.3.0 | Deploy |

**Inga skillnader** i dependencies mellan FB och IG.

---

## 2. CSV-format och kolumnmappningar

### Facebook
Källa: `_old_facebook/src/utils/columnConfig.js`

| CSV-kolumn (svenska) | Internt fältnamn |
|---|---|
| Publicerings-id | post_id |
| Sid-id | account_id |
| Sidnamn | account_name |
| Titel | description |
| Publiceringstid | publish_time |
| Inläggstyp | post_type |
| Permalänk | permalink |
| Visningar | views |
| Räckvidd | reach |
| Reaktioner, kommentarer och delningar | total_engagement |
| Reaktioner | likes |
| Kommentarer | comments |
| Delningar | shares |
| Totalt antal klick | total_clicks |
| Länkklick | link_clicks |
| Övriga klick | other_clicks |

### Instagram
Källa: `_old_instagram/src/utils/columnConfig.js`

| CSV-kolumn (svenska) | Internt fältnamn |
|---|---|
| Publicerings-id | post_id |
| Konto-id | account_id |
| Kontots användarnamn | account_username |
| Kontonamn | account_name |
| Beskrivning | description |
| Publiceringstid | publish_time |
| Inläggstyp | post_type |
| Permalänk | permalink |
| Visningar | views |
| Räckvidd | post_reach |
| Gilla-markeringar | likes |
| Kommentarer | comments |
| Delningar | shares |
| Följer | follows |
| Sparade objekt | saves |

### Viktiga skillnader i fältnamn
- FB: `reach` → IG: `post_reach` (samma koncept, olika interna namn)
- FB: `total_engagement` (direkt från CSV) → IG: `engagement_total` (beräknat: likes+comments+shares)
- FB: `description` från kolumnen "Titel" → IG: `description` från "Beskrivning"

---

## 3. Gemensamma datapunkter

Fält som finns i **båda** plattformarnas CSV-exporter (samma eller likvärdig data):

| Internt fältnamn | FB-kolumn | IG-kolumn |
|---|---|---|
| post_id | Publicerings-id | Publicerings-id |
| account_id | Sid-id | Konto-id |
| account_name | Sidnamn | Kontonamn |
| description | Titel | Beskrivning |
| publish_time | Publiceringstid | Publiceringstid |
| post_type | Inläggstyp | Inläggstyp |
| permalink | Permalänk | Permalänk |
| views | Visningar | Visningar |
| reach* | Räckvidd | Räckvidd |
| likes | Reaktioner | Gilla-markeringar |
| comments | Kommentarer | Kommentarer |
| shares | Delningar | Delningar |

*FB internt `reach`, IG internt `post_reach` – normaliseras till gemensamt `reach` i den nya appen.

---

## 4. Plattformsspecifika datapunkter

### Enbart Facebook
| Fältnamn | Beskrivning |
|---|---|
| total_engagement | Summa reaktioner+kommentarer+delningar (direkt från CSV) |
| total_clicks | Totalt antal klick |
| link_clicks | Länkklick |
| other_clicks | Övriga klick |

### Enbart Instagram
| Fältnamn | Beskrivning |
|---|---|
| account_username | Kontots användarnamn (@-handle) |
| saves | Sparade objekt |
| follows | Ny-följare via inlägg |
| engagement_total | Beräknad summa (likes+comments+shares) – saknas i CSV |
| engagement_total_extended | Beräknad summa (likes+comments+shares+saves+follows) |

---

## 5. IndexedDB – nuläge

### Facebook (`FacebookStatisticsDB` v1)
| Store | Syfte | Nyckel |
|---|---|---|
| csvData | Post view-data (vid övertag av localStorage-kvot) | autoIncrement id |
| fileMetadata | Metadata om uppladdade filer | autoIncrement id |

localStorage-nycklar: `facebook_stats_processed_data`, `facebook_stats_account_view`, `facebook_stats_post_view`, `facebook_stats_uploaded_files`, `facebook_stats_memory_usage`

### Instagram (`InstagramStatisticsDB` v1)
| Store | Syfte | Nyckel |
|---|---|---|
| csvData | Post view-data (alltid IndexedDB) | autoIncrement id |
| fileMetadata | Metadata om uppladdade filer | autoIncrement id |
| accountData | Account view-data (fallback om localStorage-kvot överskrids) | autoIncrement id |

localStorage-nycklar: `instagram_stats_processed_data`, `instagram_stats_account_view`, `instagram_stats_post_view`, `instagram_stats_uploaded_files`, `instagram_stats_memory_usage`

**Notering:** IG-appen har gjort en förbättring jämfört med FB – post view-data sparas **alltid** i IndexedDB för att undvika localStorage-kvotproblem. Dessutom finns `accountData`-storen som extra fallback.

---

## 6. UI-komponenter

### Nästan identiska (minimala skillnader)

| Komponent | FB (rader) | IG (rader) | Skillnader |
|---|---|---|---|
| FileUploader.jsx | 902 | ~900 | Fältnamn, kolumnvalideringslogik |
| MainView.jsx | 427 | ~427 | Fliktexter, fältlistor |
| AccountView.jsx | 775 | ~775 | Fältnamn (reach/post_reach, total_engagement/engagement_total), ikoner |
| PostView.jsx | 576 | ~576 | Fältnamn, FB har klickfält, IG har saves/follows |
| PostTypeView.jsx | 663 | ~663 | Fältnamn |
| TrendAnalysisView.jsx | 627 | ~627 | Mätvärden (FB: klick; IG: saves/follows) |
| MemoryIndicator.jsx | 183 | ~183 | Identisk (modellbaserad minnesuppskattning) |
| LoadedFilesInfo.jsx | liten | liten | Troligen identisk |
| useColumnMapper.js | 118 | ~118 | Importerar plattformsspecifik COLUMN_MAPPINGS |

### Helt identiska
- Alla shadcn/ui-komponenter (`ui/alert`, `ui/button`, `ui/card`, `ui/checkbox`, `ui/input`, `ui/label`, `ui/select`, `ui/switch`, `ui/table`, `ui/tabs`)
- `src/lib/utils.js` (cn-hjälpfunktion)
- `src/renderer/styles/globals.css`
- `vite.config.js` (förutom `base`-sökvägen)
- `tailwind.config.js`
- `postcss.config.js`

### Utilities med minimala skillnader
- `electronApiEmulator.js` – troligen identisk
- `memoryUtils.js` – troligen identisk
- `webDataProcessor.js` – troligen identisk
- `columnConfig.js` – samma struktur, plattformsspecifika mappningar
- `dataProcessing.js` – samma struktur, plattformsspecifika fältnamn
- `webStorageService.js` – samma struktur; IG har extra `accountData`-store och mer konsekvent IndexedDB-användning

---

## 7. Sammanfattning inför arkitekturbeslut

### Vad som kan delas fullt ut (~80% av koden)
- Alla shadcn/ui-komponenter
- webStorageService (med plattformsspecifika nyckelkonstanter)
- FileUploader (med plattformsparam)
- MainView/tabbar
- AccountView, PostView, PostTypeView, TrendAnalysisView (med props för plattformsspecifika fält)
- MemoryIndicator / StorageIndicator
- Hjälpfunktioner: normalizeText, formatValue, formatDate, getValue
- summarizeByAccount-logik
- Export-funktioner (downloadFile, downloadExcel)

### Vad som måste vara plattformsspecifikt (~20%)
- `COLUMN_MAPPINGS` – helt olika kolumnnamn
- `ACCOUNT_VIEW_FIELDS` / `POST_VIEW_FIELDS` – olika fältlistor
- Beräkning av `engagement_total` (IG räknar ut; FB läser direkt)
- Beräkning av `average_reach` (`reach` vs `post_reach`)
- Koppling till Facebook-länk i PostView (FB har externa länk-ikoner)
- IndexedDB-databasnamn och versionsstrategi

### Kritiskt att hantera i den nya appen
1. **Normalisera `reach`-fältnamnet** – välj ett internt namn (förslag: `reach`) och mappa båda.
2. **`engagement_total` vs `total_engagement`** – välj ett namn, beräkna IG-versionen, läs FB:s direkt.
3. **Enhetlig IndexedDB-strategi** – IG:s förbättrade modell (alltid IndexedDB för posts) bör användas.
4. **`platform`-fält** – lägg till `"facebook" | "instagram"` på varje post redan från parsningsstadiet.
5. **Ny databas** – `MetaAnalyticsDB` med stores per plattform + gemensam filmetadata.
