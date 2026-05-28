# Meta Analytics (SQLite)

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

> Analysera Facebook- och Instagram-statistik från Meta Business Suite samt lyssnings- och besöksdata från Google Analytics. Data lagras permanent i en lokal SQLite-databas — ladda upp CSV-filer en gång, analysera hur många gånger du vill.

---

## Funktioner

- **Facebook + Instagram** — Importera CSV-exporter från Meta Business Suite (svenska kolumnnamn)
- **Kontoräckvidd (API)** — Importera månatlig räckvidd per konto från Metas Graph API (Facebook)
- **IG-kontoräckvidd (API)** — Månatlig räckvidd per Instagram-konto från Metas Graph API. Separat från Facebook-räckvidd
- **Google Analytics** — Importera lyssningsdata (podcasts) och sajtbesök från Google Analytics. Visas i egna lägen i kontovyn och trendanalysen
- **Automatisk plattformsdetektering** — Appen identifierar plattform baserat på kolumnnamn
- **Periodväljare** — Välj månader att analysera; äldre år kollapsas automatiskt för renare UI
- **Per konto** — Summerad statistik per sida/konto med sorterbara kolumner och räckviddskolumner per månad
- **Per inlägg** — Fullständig tabell med serverbaserad paginering, filtrering och sortering
- **Per inläggstyp** — Genomsnittlig statistik grupperad efter typ (Reels, Foton, Videor, Stories)
- **Trendanalys** — Månatliga trendkurvor per konto för valfritt mätvärde, inklusive kontoräckvidd, länkklick snitt/dag och GA-lyssningar snitt/dag
- **Plattformstrend** — Aggregerad vy som visar snitt visningar/inlägg, snitt räckvidd/inlägg och antal inlägg över alla konton. Inkluderar barometer (Stigande/Stabil/Fallande) med kortsiktig trend och år-mot-år-jämförelse. Filtrerbar på Alla/P4 Lokalt/Riks och Facebook/Instagram
- **Jämförelser** — Korsreferera GA-sajtbesök mot Meta-länkklick per konto och månad. Visar bägge datakällorna i samma diagram
- **Kontogrupper** — Skapa namngivna grupper av konton (t.ex. "Alla P4") för aggregerad visning i kontovyn, trendanalysen och jämförelser
- **Dolda konton** — Dölj konton från alla vyer utan att radera data. Hanteras via kontovyn
- **Samarbetsdetektering** — Automatisk identifiering av samarbetsinlägg (collab posts) mellan konton
- **Uppskattade unika klickare** — Beräknar uppskattat antal unika länkklickare baserat på överlappsfaktor mellan inläggsräckvidd och kontoräckvidd
- **Snitt per dag** — Automatisk beräkning av snitt visningar/dag, snitt länkklick/dag och snitt lyssningar/dag
- **Persistent data** — SQLite-databas på disk. Data överlever omstarter, ingen 12h-rensning
- **Import-hantering** — Lista, radera och se månadsöversikt för importerad data
- **Export** — Ladda ned tabeller som CSV eller Excel (.xlsx)
- **Docker-stöd** — Kör i container med `docker compose up`
- **Databasbackup** — Ladda ned .db-filen direkt från gränssnittet
- **Deterministisk deduplicering** — Dubletter i CSV-exporter hanteras automatiskt (behåller raden med högst interaktioner)
- **Om appen** — Inbyggd mätpunktsreferens och dokumentation om datahantering

---

## Snabbstart

### Alt 1: Docker (rekommenderat för produktion)

```bash
git clone https://github.com/cgillinger/metaDB.git
cd metaDB
docker compose up --build -d
```

Öppna [http://localhost:3001](http://localhost:3001). Databasen sparas i `./data/analytics.db`.

Stoppa:
```bash
docker compose down
```

Data finns kvar i `./data/` och laddas automatiskt nästa gång du startar.

### Alt 2: Nativ (utveckling)

```bash
git clone https://github.com/cgillinger/metaDB.git
cd metaDB
npm install
npm run dev
```

Öppnar Vite dev-server på [http://localhost:5173](http://localhost:5173) med hot reload.
Express-servern startar på port 3001 och Vite proxar `/api/*` dit automatiskt.

### Alt 3: Nativ (produktion utan Docker)

```bash
npm install
npm run build
npm start
```

Öppna [http://localhost:3001](http://localhost:3001). Express serverar frontend + API från samma port.

---

## Hur man använder appen

1. **Importera CSV** — Dra och släpp CSV-filer från Meta Business Suite
2. **Välj mätvärden** — Kryssa i vilka värden som ska visas i tabellerna
3. **Utforska** — Navigera mellan flikarna *Per konto*, *Per inlägg*, *Per inläggstyp* och *Trendanalys*
4. **Exportera** — Klicka CSV- eller Excel-knappen för att ladda ned aktuell vy
5. **Hantera data** — Fliken *Databas* visar importer, månadsöversikt, och ger möjlighet att radera enskilda importer

---

## Dataformat

Appen stöder tre typer av dataimport:

### 1. Facebook-CSV (inläggsstatistik)

**Källa:** Meta Business Suite → Insikter → Exportera (svenska)

| CSV-kolumn | Internt fält | Beskrivning |
|---|---|---|
| Publicerings-id | `post_id` | Unikt inläggs-ID |
| Sid-id | `account_id` | Facebook-sidans ID |
| Sidnamn | `account_name` | Sidans namn |
| Titel | `description` | Inläggstext |
| Publiceringstid | `publish_time` | Tidsstämpel (konverteras från PT till CET) |
| Inläggstyp | `post_type` | Foton, Videor, Länkar, Status |
| Permalänk | `permalink` | URL till inlägget |
| Visningar | `views` | Antal visningar |
| Räckvidd | `reach` | Antal unika personer som sett inlägget |
| Reaktioner, kommentarer och delningar | `interactions` | Summa interaktioner |
| Reaktioner | `likes` | Gilla/reaktioner |
| Kommentarer | `comments` | Antal kommentarer |
| Delningar | `shares` | Antal delningar |
| Totalt antal klick | `total_clicks` | Alla klick (länk + övriga) |
| Länkklick | `link_clicks` | Klick på länkar |
| Övriga klick | `other_clicks` | Klick på bild, "läs mer", profil etc. |

### 2. Instagram-CSV (inläggsstatistik)

**Källa:** Meta Business Suite → Insikter → Exportera (svenska)

| CSV-kolumn | Internt fält | Beskrivning |
|---|---|---|
| Publicerings-id | `post_id` | Unikt inläggs-ID |
| Konto-id | `account_id` | Instagram-kontots ID |
| Kontots användarnamn | `account_username` | @-användarnamn |
| Kontonamn | `account_name` | Kontots visningsnamn |
| Beskrivning | `description` | Inläggstext/caption |
| Publiceringstid | `publish_time` | Tidsstämpel (konverteras från PT till CET) |
| Inläggstyp | `post_type` | Reels, Foton, Stories, Videor |
| Permalänk | `permalink` | URL till inlägget |
| Visningar | `views` | Antal visningar |
| Räckvidd | `reach` | Antal unika personer |
| Gilla-markeringar | `likes` | Antal gilla |
| Kommentarer | `comments` | Antal kommentarer |
| Delningar | `shares` | Antal delningar |
| Följer | `follows` | Nya följare från inlägget |
| Sparade objekt | `saves` | Antal sparade |

**Skillnader mot Facebook:** Instagram saknar klickdata (total_clicks, link_clicks, other_clicks). Instagram har istället sparade objekt och följare.

### 3. Kontoräckvidd-CSV (API-data)

**Källa:** Metas Graph API (exporteras separat, inte via Meta Business Suite)

| CSV-kolumn | Beskrivning |
|---|---|
| Page | Sidans namn |
| Page ID | Facebook-sidans ID |
| Reach | Total räckvidd för månaden |

**Begränsningar:**
- **Enbart Facebook** — Instagram-kontoräckvidd stöds inte
- **Månad anges manuellt** — CSV-filen innehåller ingen datuminformation; användaren väljer månad vid import
- **En rad per konto** — Varje rad är ett konto, inte ett inlägg
- **Lagras separat** — Data sparas i tabellen `account_reach`, inte i `posts`
- **Visas per månad** — I kontovyn visas en kolumn per importerad månad
- **Ej aggregerbar** — Räckvidd kan inte summeras eller delas upp; varje månadsvärde visas som det är
- **Konton utan inlägg** — Om ett konto bara har räckviddsdata (inga importerade inlägg) visas det ändå i kontovyn och trendanalysen

---

## Arkitektur

```
┌──────────────────────────────────────────────────┐
│  Docker container (eller nativ Node.js)          │
│                                                  │
│   Webbläsare (React)                             │
│       ↕ fetch('/api/...')                        │
│   Express-server (port 3001)                     │
│       ↕ better-sqlite3                           │
│   ./data/analytics.db                            │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Teknisk stack

| Teknologi | Syfte |
|---|---|
| [React 18](https://react.dev) | Frontend |
| [Vite 5](https://vitejs.dev) | Byggesystem, dev-server med proxy |
| [Tailwind CSS 3](https://tailwindcss.com) | Styling |
| [shadcn/ui](https://ui.shadcn.com) | UI-komponenter |
| [Express 4](https://expressjs.com) | REST API-server |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | SQLite-databas |
| [PapaParse](https://www.papaparse.com) | CSV-parsning (server-side) |
| [SheetJS](https://sheetjs.com) | Excel-export (client-side) |
| [Chart.js](https://www.chartjs.org) | Diagram för plattformstrend och jämförelser |

### Projektstruktur

```
├── Dockerfile                    # Multi-stage build
├── docker-compose.yml            # Volume + port-mappning
├── server/
│   ├── index.js                  # Express entry point
│   ├── db/
│   │   ├── connection.js         # SQLite-anslutning + migrationer
│   │   ├── schema.sql            # Databasschema
│   │   └── migrations/           # SQL-migreringsfiler
│   ├── routes/
│   │   ├── imports.js            # CSV-upload, lista, radera, coverage
│   │   ├── posts.js              # Inlägg med paginering
│   │   ├── accounts.js           # Kontoaggregering + kontoräckvidd
│   │   ├── postTypes.js          # Inläggstypsstatistik
│   │   ├── trends.js             # Trendanalys per konto (inkl. account_reach)
│   │   ├── platformTrends.js     # Aggregerad plattformstrend + barometer
│   │   ├── comparison.js         # GA-sajtbesök vs Meta-länkklick
│   │   ├── accountGroups.js      # Namngivna kontogrupper
│   │   ├── hiddenAccounts.js     # Dölj/visa konton
│   │   ├── reach.js              # Facebook-kontoräckvidd (Graph API)
│   │   ├── igReach.js            # Instagram-kontoräckvidd (Graph API)
│   │   ├── gaListens.js          # Google Analytics lyssningsdata
│   │   ├── gaSiteVisits.js       # Google Analytics sajtbesök
│   │   └── maintenance.js        # VACUUM, backup, stats
│   └── services/
│       ├── csvProcessor.js       # CSV-parsning, kolumnmappning, tidszon
│       ├── collabDetector.js     # Samarbetskontodetektering
│       ├── estimatedUniqueClicks.js # Uppskattade unika länkklickare
│       ├── accountGroupService.js   # Logik för kontogrupper
│       ├── comparisonService.js     # Aggregering för jämförelsevyn
│       ├── hiddenAccounts.js     # Hantering av dolda konton
│       ├── reachImporter.js      # Import av FB-kontoräckvidd från Graph API
│       ├── igReachImporter.js    # Import av IG-kontoräckvidd från Graph API
│       ├── gaListensImporter.js  # Import av GA-lyssningsdata
│       └── gaSiteVisitsImporter.js  # Import av GA-sajtbesök
├── shared/
│   ├── columnConfig.js           # Kolumnmappningar (server + client)
│   └── p4Regions.js              # P4-regionsfilter (Lokalt/Riks)
├── data/
│   └── analytics.db              # SQLite-databas (skapas vid körning)
├── src/
│   ├── index.jsx                 # React entry point
│   ├── utils/
│   │   └── apiClient.js          # API-klient (fetch-wrapper)
│   └── renderer/
│       ├── App.jsx
│       └── components/
│           ├── FileUploader/     # CSV-uppladdning
│           ├── MainView/         # Fliknavigering + fältval
│           ├── PeriodSelector/   # Periodväljare (kollapsbar per år)
│           ├── AccountView/      # Per konto (inkl. räckviddskolumner)
│           ├── PostView/         # Per inlägg
│           ├── PostTypeView/     # Per inläggstyp
│           ├── TrendAnalysisView/# Trendanalys (inkl. kontoräckvidd)
│           ├── PlatformTrendView/# Plattformstrend + barometer (Chart.js)
│           ├── ComparisonView/   # Jämförelser GA vs Meta (Chart.js)
│           ├── AccountGroups/    # Hantering av kontogrupper
│           ├── HiddenAccountsManager/ # Hantering av dolda konton
│           ├── AboutView/        # Om appen + mätpunktsreferens
│           ├── ImportManager/    # Databashantering + räckviddsimport
│           └── ui/               # shadcn/ui-komponenter
└── package.json
```

---

## API-endpoints

| Metod | Endpoint | Beskrivning |
|---|---|---|
| GET | `/api/health` | Hälsokontroll |
| GET | `/api/imports` | Lista alla importer |
| POST | `/api/imports` | Ladda upp CSV (multipart) |
| DELETE | `/api/imports/:id` | Radera import + inlägg |
| GET | `/api/imports/coverage` | Månadsöversikt (inkl. reach-only månader) |
| GET | `/api/posts` | Inlägg (paginering, filter, sort). Filter: `accountName` + `accountPlatform` |
| GET | `/api/accounts` | Kontoaggregering + kontoräckvidd per månad |
| GET | `/api/post-types` | Statistik per inläggstyp. Filter: `accountName` + `accountPlatform` |
| GET | `/api/trends` | Trenddata per konto. Filter: `accountKeys` (format: `name::platform`) |
| GET | `/api/platform-trends` | Aggregerad plattformstrend. Filter: plattform, grupp, månader |
| GET | `/api/comparison/accounts` | Konton med både GA-besök och Meta-länkklick |
| GET | `/api/comparison/besok-lankklick` | GA-sajtbesök vs Meta-länkklick per konto |
| GET | `/api/comparison/besok-lankklick-group` | Samma jämförelse aggregerad per kontogrupp |
| GET · POST | `/api/account-groups` | Lista respektive skapa kontogrupper |
| PUT · DELETE | `/api/account-groups/:id` | Uppdatera respektive radera en kontogrupp |
| GET · POST · DELETE | `/api/hidden-accounts` | Lista, dölj respektive visa konton |
| POST · GET · DELETE | `/api/reach` | Importera, lista månader och radera FB-kontoräckvidd |
| POST · GET · DELETE | `/api/ig-reach` | Importera, lista och radera IG-kontoräckvidd |
| POST · GET · DELETE | `/api/ga-listens` | Importera, hämta och radera GA-lyssningsdata |
| POST · GET · DELETE | `/api/ga-site-visits` | Importera, hämta och radera GA-sajtbesök |
| GET | `/api/maintenance/stats` | Databasstorlek, antal |
| POST | `/api/maintenance/vacuum` | Komprimera databasen |
| GET | `/api/maintenance/backup` | Ladda ned .db-fil |

---

## Viktiga regler

- **Räckvidd (reach)** beräknas alltid som genomsnitt (AVG), aldrig som summa
- **Snitt/dag-mätvärden** (`avg_daily_link_clicks`, `avg_daily_listens`) beräknas alltid client-side via `daysInMonth()` och skickas aldrig till databasen. Länkklick snitt/dag visas automatiskt i kontovyn när länkklick är valt (kräver periodfilter). I trendanalysen är det ett valbart alternativ för både posts-läge (Facebook) och GA-läge.
- **Kontoräckvidd (account_reach)** — Månatlig räckvidd per konto från Metas Graph API. Lagras i separat tabell (`account_reach`), visas som en kolumn per månad i kontovyn och som trendlinje i trendanalysen. Gäller enbart Facebook.
- **Engagemang** skiljer sig per plattform:
  - Facebook: reaktioner + kommentarer + delningar + klick
  - Instagram: gilla + kommentarer + delningar + sparade + följare
- **Kontidentifiering** — Konton identifieras alltid med `account_name` + `platform` (kompositnyckel). Samma kontonamn kan finnas på både Facebook och Instagram och hanteras som separata konton genom hela appen.
- **Kontogrupper** — Namngivna grupper av konton (t.ex. "Alla P4") som kan väljas för aggregerad visning i kontovyn, trendanalysen och jämförelser. Lagras separat och påverkar inte underliggande data.
- **Dolda konton** — Konton kan döljas från alla vyer utan att data raderas. Hanteras via kontovyn och kan när som helst visas igen.
- **P4-regionsfilter** — Konton klassas som *P4 Lokalt* eller *Riks* via `shared/p4Regions.js`. Används bl.a. som filter i plattformstrenden.
- **Deduplicering**: samma `post_id` + plattform = samma inlägg (uppdateras vid reimport)
- **Tidszon**: Meta exporterar i Pacific Time — konverteras till Stockholm-tid vid import

---

## Docker-detaljer

- Volymen `./data:/data` är kritisk — utan den försvinner databasen med containern
- Express binder till `0.0.0.0` i containern men porten mappas till `127.0.0.1:3001` på värden
- `better-sqlite3` kompileras i containern (Alpine Linux), inte på värden
- VACUUM kräver tillfälligt 2× databasstorlek i ledigt utrymme

---

## Säkerhet

Appen är avsedd att köras på **LAN eller Tailscale** — inte exponerad direkt mot publikt internet. Säkerhetshärdningen ger ett extra skyddslager men ersätter inte nätverksisolering.

### Skyddslager

| Skydd | Detalj |
|---|---|
| **HTTP-säkerhetsheaders** | [helmet](https://helmetjs.github.io/) sätter `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` m.fl. |
| **Rate limiting** | API: 200 req/min · Uppladdning: 10 req/min · Backup: 2 req/min |
| **JSON body-gräns** | Max 1 MB per request |
| **CSV-validering** | Multer tillåter enbart CSV (MIME-typ eller `.csv`-ändelse), max 50 MB |
| **SQL-whitelisting** | Metric- och sort-parametrar matchas mot explicita maps — ingen dynamisk stränginterpolering i SQL |
| **Non-root container** | Processen kör som `appuser` (inte root) inuti Docker-containern |

### ADMIN_TOKEN — skydda underhållsendpoints

Endpointerna `/api/maintenance/stats`, `/vacuum` och `/redetect-collab` kan skyddas med ett hemligt token. Sätt det i `docker-compose.yml`:

```yaml
environment:
  # - ADMIN_TOKEN=byt-till-ditt-eget-token
```

Med token satt krävs headern `X-Admin-Token: <token>` för att nå dessa endpoints. Utan token är de öppna (standardläget för LAN-bruk).

Backup-endpointen (`/api/maintenance/backup`) är alltid öppen men rate-limitad till 2 nedladdningar per minut.

---

## Licens

MIT © cgillinger
