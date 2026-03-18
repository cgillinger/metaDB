# Instagram Statistik

Webbapplikation för att analysera Instagram-statistik från CSV-filer exporterade via Meta Business Suite.

## Funktioner

- **Multi-CSV-uppladdning**: Ladda upp flera CSV-filer samtidigt via drag-and-drop eller filväljare. Filerna bearbetas sekventiellt med progress-indikator per fil. Du kan ta bort enskilda filer, rensa alla, eller försöka igen med misslyckade filer.
- **Per-konto-vy**: Summerad statistik per Instagram-konto med sortering, filtrering och export.
- **Per-inlägg-vy**: Detaljerad statistik för varje inlägg med länk till originalet.
- **Per-inläggstyp-vy**: Analys med cirkeldiagram för fördelning av inläggstyper.
- **Trendanalys**: Linjediagram som visar månatlig utveckling per konto och mätvärde.
- **Export**: Exportera data till CSV eller Excel.
- **Minnesskydd**: Appen övervakar minnesanvändning och varnar vid hög belastning.

## Kolumnmappningar

Kolumnmappningarna är hårdkodade i `src/utils/columnConfig.js`. Det finns ingen editor-UI. Om Meta ändrar kolumnnamn i sina exportfiler uppdateras `COLUMN_MAPPINGS`-objektet direkt i den filen.

Appen förväntar sig följande svenska kolumnnamn från Meta Business Suite:
`Publicerings-id`, `Konto-id`, `Kontots användarnamn`, `Kontonamn`, `Beskrivning`, `Publiceringstid`, `Inläggstyp`, `Permalänk`, `Visningar`, `Räckvidd`, `Gilla-markeringar`, `Kommentarer`, `Delningar`, `Följer`, `Sparade objekt`

## Kom igång

```bash
npm install
npm run dev
```

Bygg för produktion:

```bash
npm run build
```

## Dataintegritet

All data behandlas lokalt i din webbläsare. Ingen data skickas till externa servrar.
