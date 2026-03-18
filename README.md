# Meta Analytics

![Deploy to GitHub Pages](https://github.com/cgillinger/meta_analytics/actions/workflows/deploy.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38BDF8?logo=tailwindcss&logoColor=white)

> Analysera Facebook- och Instagram-statistik direkt i webbläsaren — utan att ladda upp data till någon server.

---

## Funktioner

- **Stöd för båda plattformarna** — Ladda in CSV-exporter från Facebook och Instagram i samma session
- **Automatisk plattformsdetektering** — Appen identifierar om filen är från Facebook eller Instagram baserat på kolumnnamnen
- **Per konto** — Summerad statistik per sida/konto med sorterbara kolumner och exportmöjligheter
- **Per inlägg** — Fullständig inläggstabell med plattformsbadge, inläggstyp, expanderbara beskrivningar och direktlänkar
- **Per inläggstyp** — Aggregerad genomsnittsstatistik grupperad efter typ (Reels, Foton, Videor, Stories m.m.) med pajdiagram
- **Trendanalys** — Månatliga trendkurvor per konto för valfritt mätvärde
- **Lokal datahantering** — All data lagras i webbläsarens IndexedDB, inget skickas externt
- **Export** — Ladda ned resultattabeller som CSV eller Excel (.xlsx)
- **Minnesövervakning** — Inbyggd lagringsindikator med varning vid hög användning

---

## Kom igång

### Krav

- Node.js 22+
- npm

### Installation

```bash
git clone https://github.com/cgillinger/meta_analytics.git
cd meta_analytics
npm install
npm run dev
```

Öppna [http://localhost:5173](http://localhost:5173) i webbläsaren.

### Bygge

```bash
npm run build
```

Den färdiga appen hamnar i `dist/`.

---

## Hur man använder appen

1. **Ladda in CSV** — Dra och släpp en eller flera CSV-filer från Meta Business Suite på uppladdningsytan (stöd för batch-import)
2. **Välj mätvärden** — Kryssa i vilka värden som ska visas i tabellerna
3. **Utforska** — Navigera mellan flikarna *Per konto*, *Per inlägg*, *Per inläggstyp* och *Trendanalys*
4. **Exportera** — Klicka på CSV- eller Excel-knappen för att ladda ned aktuell vy
5. **Lägg till mer data** — Klicka *Lägg till data* för att komplettera med fler filer utan att förlora befintliga resultat

---

## CSV-format som stöds

| Plattform | Källa | Kolumnspråk |
|---|---|---|
| Facebook | Meta Business Suite → Insikter → Exportera | Svenska |
| Instagram | Meta Business Suite → Insikter → Exportera | Svenska |

Appen identifierar automatiskt plattform baserat på kolumnnamnen i filen.

---

## Teknisk stack

| Teknologi | Syfte |
|---|---|
| [React 18](https://react.dev) | UI-ramverk |
| [Vite 5](https://vitejs.dev) | Byggesystem och dev-server |
| [Tailwind CSS 3](https://tailwindcss.com) | Styling |
| [shadcn/ui](https://ui.shadcn.com) (Radix UI) | Komponentprimitiver |
| [PapaParse](https://www.papaparse.com) | CSV-parsning |
| [SheetJS (xlsx)](https://sheetjs.com) | Excel-export |
| [Lucide React](https://lucide.dev) | Ikoner |
| IndexedDB | Lokal datalagring |

---

## Projektstruktur

```
src/
├── index.jsx                     # App-entrypoint
├── renderer/
│   ├── App.jsx                   # Rot-komponent
│   ├── styles/globals.css
│   └── components/
│       ├── FileUploader/         # CSV-inläsning med plattformsdetektering
│       ├── MainView/             # Huvudvy med fliknavigering
│       ├── AccountView/          # Statistik per konto
│       ├── PostView/             # Statistik per inlägg
│       ├── PostTypeView/         # Statistik per inläggstyp
│       ├── TrendAnalysisView/    # Månadsvis trendanalys
│       ├── StorageIndicator/     # Lagringsanvändning
│       ├── LoadedFilesInfo/      # Hantering av inlästa filer
│       └── ui/                   # shadcn/ui-komponenter
└── utils/
    ├── columnConfig.js           # Kolumnmappningar + plattformsdetektering
    ├── webDataProcessor.js       # CSV-parsning och normalisering
    ├── storageService.js         # IndexedDB + localStorage
    ├── dataProcessing.js         # Fältdefinitioner för vyer
    ├── memoryUtils.js            # Minnesgränser och beräkningar
    └── electronApiEmulator.js    # Web-kompatibilitetsshim
```

---

## Deploy

Appen deployar automatiskt till GitHub Pages vid varje push till `main`.

**Manuell deploy:**
```bash
gh workflow run deploy.yml
```

**Live-URL:** `https://cgillinger.github.io/meta_analytics/`

---

## Dataintegritet

All data stannar lokalt i din webbläsare. Inga CSV-filer eller statistikvärden skickas till någon extern server. Data rensas automatiskt efter 12 timmar via en inbyggd cleanup-rutin.

---

## Licens

MIT © cgillinger
