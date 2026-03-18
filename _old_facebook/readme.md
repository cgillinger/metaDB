# Facebook Statistik

En webbapplikation för att analysera och visualisera statistik från Facebook-inlägg. Applikationen låter dig ladda upp CSV-filer som exporterats från Facebook Insights (Meta Business Suite) och visualisera data på ett lättöverskådligt sätt.

**Live Demo:** [https://cgillinger.github.io/facebook_stats/](https://cgillinger.github.io/facebook_stats/)

## Funktioner

- **Filtrering per konto eller per inlägg** - Analysera data per Facebook-sida eller på inläggsnivå
- **Anpassningsbara visualiseringar** - Välj vilka värden som ska visas i tabeller
- **100% Klientbaserad** - All data bearbetas lokalt i webbläsaren, ingen data skickas till någon server
- **Lokalt datalagring** - Sparar data i din webbläsare för snabb åtkomst
- **Exportmöjligheter** - Exportera analyserad data till CSV eller Excel
- **Minnes- och datahantering** - Kontrollerar och hanterar minnesanvändning och filstorlek

## Teknisk stack

- React 18
- Vite
- TailwindCSS
- ShadcnUI (komponentbibliotek)
- PapaParse (CSV-parser)
- Recharts (för diagramvisualiseringar)
- SheetJS (för Excel-export)
- LocalStorage och IndexedDB för datalagring

## Installation och utveckling

### Förutsättningar
- Node.js (v14 eller senare)
- npm eller yarn

### Installation

1. Klona repot
   ```bash
   git clone https://github.com/cgillinger/facebook_stats.git
   cd facebook_stats
   ```

2. Installera beroenden
   ```bash
   npm install
   # eller
   yarn
   ```

3. Starta utvecklingsserver
   ```bash
   npm run dev
   # eller
   yarn dev
   ```

4. Öppna `http://localhost:5173` i din webbläsare

### Bygga för produktion

```bash
npm run build
# eller
yarn build
```

## Användning

### Dataimport

1. Exportera statistikdata från Facebook/Meta Business Suite som CSV-fil
2. Ladda upp CSV-filen i appen
3. Välj vilka värden du vill visa och analysera

### Kolumnmappningar

Kolumnmappningarna är hårdkodade för svenska kolumnnamn från Meta Business Suite. Om Meta ändrar kolumnnamn i exportfiler, uppdatera `src/utils/columnConfig.js`.

### Hantera data

- Klicka på "Lägg till data" för att lägga till mer statistik
- Använd "Återställ data" för att rensa alla inlästa data och börja om
- Vid varje app-start rensas tidigare data för en ren start

### Exportera data

- Använd knapparna för CSV/Excel-export i tabellfönstret

## Deployment

Att deploya appen till GitHub Pages:

```bash
npm run deploy
# eller
yarn deploy
```

Detta kommer att bygga appen och publicera den till GitHub Pages. Appen kommer att finnas tillgänglig på `https://cgillinger.github.io/facebook_stats/`.

## Licens

[MIT License](LICENSE)

## Upphovsrätt

© 2025 Christian Gillinger
