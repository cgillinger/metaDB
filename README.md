# Meta Analytics (SQLite)

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

> Analysera Facebook- och Instagram-statistik från Meta Business Suite. Data lagras permanent i en lokal SQLite-databas — ladda upp CSV-filer en gång, analysera hur många gånger du vill.

---

## Funktioner

- **Facebook + Instagram** — Importera CSV-exporter från Meta Business Suite (svenska kolumnnamn)
- **Automatisk plattformsdetektering** — Appen identifierar plattform baserat på kolumnnamn
- **Per konto** — Summerad statistik per sida/konto med sorterbara kolumner
- **Per inlägg** — Fullständig tabell med serverbaserad paginering, filtrering och sortering
- **Per inläggstyp** — Genomsnittlig statistik grupperad efter typ (Reels, Foton, Videor, Stories)
- **Trendanalys** — Månatliga trendkurvor per konto för valfritt mätvärde
- **Persistent data** — SQLite-databas på disk. Data överlever omstarter, ingen 12h-rensning
- **Import-hantering** — Lista, radera och se månadsöversikt för importerad data
- **Export** — Ladda ned tabeller som CSV eller Excel (.xlsx)
- **Docker-stöd** — Kör i container med `docker compose up`
- **Databasbackup** — Ladda ned .db-filen direkt från gränssnittet

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

## CSV-format

| Plattform | Källa | Kolumnspråk |
|---|---|---|
| Facebook | Meta Business Suite → Insikter → Exportera | Svenska |
| Instagram | Meta Business Suite → Insikter → Exportera | Svenska |

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
│   │   ├── imports.js            # CSV-upload, lista, radera
│   │   ├── posts.js              # Inlägg med paginering
│   │   ├── accounts.js           # Kontoaggregering (SQL)
│   │   ├── postTypes.js          # Inläggstypsstatistik
│   │   ├── trends.js             # Trendanalys per konto
│   │   └── maintenance.js        # VACUUM, backup, stats
│   └── services/
│       ├── csvProcessor.js       # CSV-parsning, kolumnmappning, tidszon
│       └── collabDetector.js     # Samarbetskontodetektering
├── shared/
│   └── columnConfig.js           # Kolumnmappningar (server + client)
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
│           ├── AccountView/      # Per konto
│           ├── PostView/         # Per inlägg
│           ├── PostTypeView/     # Per inläggstyp
│           ├── TrendAnalysisView/# Trendanalys
│           ├── ImportManager/    # Databashantering
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
| GET | `/api/imports/coverage` | Månadsöversikt |
| GET | `/api/posts` | Inlägg (paginering, filter, sort) |
| GET | `/api/accounts` | Kontoaggregering |
| GET | `/api/post-types` | Statistik per inläggstyp |
| GET | `/api/trends` | Trenddata per konto |
| GET | `/api/maintenance/stats` | Databasstorlek, antal |
| POST | `/api/maintenance/vacuum` | Komprimera databasen |
| GET | `/api/maintenance/backup` | Ladda ned .db-fil |

---

## Viktiga regler

- **Räckvidd (reach)** beräknas alltid som genomsnitt (AVG), aldrig som summa
- **Engagemang** skiljer sig per plattform:
  - Facebook: reaktioner + kommentarer + delningar + klick
  - Instagram: gilla + kommentarer + delningar + sparade + följare
- **Deduplicering**: samma `post_id` + plattform = samma inlägg (uppdateras vid reimport)
- **Tidszon**: Meta exporterar i Pacific Time — konverteras till Stockholm-tid vid import

---

## Docker-detaljer

- Volymen `./data:/data` är kritisk — utan den försvinner databasen med containern
- Express binder till `0.0.0.0` i containern men porten mappas till `127.0.0.1:3001` på värden
- `better-sqlite3` kompileras i containern (Alpine Linux), inte på värden
- VACUUM kräver tillfälligt 2× databasstorlek i ledigt utrymme

---

## Licens

MIT © cgillinger
