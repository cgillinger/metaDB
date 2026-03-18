# Instagram Statistik App - Teknisk Dokumentation

## Översikt

Instagram Statistik App är en webbapplikation designad för att analysera och visualisera statistikdata från Instagram-exportfiler. Appen låter användare ladda upp en eller flera CSV-filer exporterade från Meta Business Suite, bearbeta datan, och visa insikter per konto, per inlägg, per inläggstyp och i trendanalys. Applikationen är helt klientbaserad och sparar all data lokalt i användarens webbläsare.

## Teknisk stack

- **Frontend**: React 18
- **UI-komponentbibliotek**: Shadcn/UI-komponenter med Tailwind CSS
- **Datahantering**: PapaParse (CSV-parser), xlsx (Excel-hantering)
- **Stilar**: Tailwind CSS för styling
- **Datalagring**: IndexedDB och localStorage för datalagring i webbläsaren
- **Byggverktyg**: Vite

## Huvudfunktioner

1. **Multi-CSV-import**: Stöd för att ladda upp flera CSV-filer samtidigt med drag-and-drop, batch-processering och progress-indikation per fil
2. **Hårdkodade kolumnmappningar**: Kolumnmappningar för svenska CSV-kolumnnamn från Meta Business Suite är hårdkodade i `src/utils/columnConfig.js`
3. **Datavisualisering**: Statistik per konto, per inlägg, per inläggstyp och trendanalys med linjediagram
4. **Filtrering & sortering**: Möjlighet att filtrera och sortera data i alla vyer
5. **Export**: Export av bearbetad data till CSV eller Excel
6. **Minneshantering**: Avancerad minneshantering för att optimera prestanda i webbläsaren

## Kodstruktur och filöversikt

### Kärnkomponenter

#### App och huvudlayout
- **src/renderer/App.jsx** - Applikationens root-komponent, hanterar global state, navigation
- **src/renderer/index.jsx** - Entry point för appen, renderar App-komponenten

#### Huvudvyer
- **src/renderer/components/MainView/MainView.jsx** - Huvudvy som hanterar växling mellan vyer
- **src/renderer/components/AccountView/AccountView.jsx** - Visar data aggregerad per Instagram-konto
- **src/renderer/components/PostView/PostView.jsx** - Visar data för individuella Instagram-inlägg
- **src/renderer/components/PostTypeView/PostTypeView.jsx** - Analys av inläggstyper med cirkeldiagram
- **src/renderer/components/TrendAnalysisView/TrendAnalysisView.jsx** - Trendanalys med SVG-linjediagram per månad och konto

#### Filuppladdning och databearbetning
- **src/renderer/components/FileUploader/FileUploader.jsx** - Hanterar uppladdning av flera CSV-filer, validering, batch-processering
- **src/renderer/components/FileUploader/useColumnMapper.js** - Hook för att validera CSV-kolumner mot hårdkodade mappningar
- **src/utils/webDataProcessor.js** - Huvudlogik för bearbetning av CSV-data
- **src/utils/dataProcessing.js** - Hjälpfunktioner för databearbetning och -transformering

#### Kolumnmappningar (hårdkodade)
- **src/utils/columnConfig.js** - Hårdkodade kolumnmappningar (svenska CSV-namn → interna fältnamn). Ingen editor, ingen localStorage. Ändra direkt i denna fil om Meta byter kolumnnamn.

#### Minneshantering
- **src/renderer/components/MemoryIndicator/MemoryIndicator.jsx** - Visar minnesanvändning
- **src/utils/memoryUtils.js** - Funktioner för att beräkna och hantera minnesanvändning
- **src/utils/webStorageService.js** - Hantering av lagring med localStorage och IndexedDB

### UI-komponenter

Appen använder ett anpassat UI-bibliotek baserat på shadcn/ui komponenter:

- **src/renderer/components/ui/alert.jsx** - Alert-komponent för notiser
- **src/renderer/components/ui/button.jsx** - Button-komponent
- **src/renderer/components/ui/card.jsx** - Card-komponenter för innehåll
- **src/renderer/components/ui/checkbox.jsx** - Checkbox-komponent
- **src/renderer/components/ui/input.jsx** - Input-komponent
- **src/renderer/components/ui/label.jsx** - Label-komponent
- **src/renderer/components/ui/select.jsx** - Select-komponent (dropdown)
- **src/renderer/components/ui/switch.jsx** - Switch-komponent (toggle)
- **src/renderer/components/ui/tabs.jsx** - Tabs-komponenter
- **src/renderer/components/ui/table.jsx** - Table-komponent för datapresentation

### Konfigurations- och byggfiler
- **vite.config.js** - Konfiguration för Vite-byggverktyget
- **tailwind.config.js** - Konfiguration för Tailwind CSS
- **postcss.config.js** - PostCSS-konfiguration
- **package.json** - Projektberoenden och skript

## Nyckelkomponenternas funktionalitet

### Multi-CSV-uppladdning

`FileUploader.jsx` hanterar uppladdning av en eller flera CSV-filer. Funktioner:
- Drag-and-drop för flera filer samtidigt (eller klicka för att välja)
- Fil-lista med status per fil: väntar / bearbetar / klar / fel
- Sekventiell batch-processering med progress-indikator
- Batch-resultat: antal lyckade / misslyckade
- Knapp för att ta bort enskild fil, rensa alla, försöka igen med misslyckade
- Minnesprojektion för alla filer

### Datavisning

Data presenteras i fyra vyer:

#### AccountView (Per konto)
- Visar aggregerade mätvärden per Instagram-konto
- Beräknar summeringar och genomsnitt
- Visar "total"-rad för alla konton
- Stöder export till CSV/Excel
- Tillhandahåller sortering och filtrering

#### PostView (Per inlägg)
- Visar detaljerade mätvärden för varje Instagram-inlägg
- Stöder filtrering per konto
- Inkluderar länkar till originella Instagram-inlägg
- Tillhandahåller sortering och paginering
- Stöder export till CSV/Excel

#### PostTypeView (Per inläggstyp)
- Aggregerar statistik per inläggstyp (Reels, Stories, Feed etc.)
- Cirkeldiagram för fördelning av inläggstyper
- Visa endast statistiskt tillförlitliga typer (≥5 inlägg)

#### TrendAnalysisView (Trendanalys)
- SVG-baserat linjediagram med smooth curves (cubic bezier)
- Visar utveclingen per månad för varje valt konto
- Val av mätvärde via radio-knappar
- Val av konton via checkboxar med "Välj alla"/"Avmarkera alla"
- Hover-tooltip med konto, månad och värde
- Färgkodad legenda per konto

### Kolumnmappningar (hårdkodade)

Kolumnmappningarna finns i `src/utils/columnConfig.js`. Det finns ingen editor eller UI för att ändra mappningar — om Meta ändrar kolumnnamn i sina exportfiler uppdaterar man `COLUMN_MAPPINGS`-objektet direkt i filen.

Aktuella mappningar (svenska CSV → internt fältnamn):
- `Publicerings-id` → `post_id`
- `Konto-id` → `account_id`
- `Kontots användarnamn` → `account_username`
- `Kontonamn` → `account_name`
- `Beskrivning` → `description`
- `Publiceringstid` → `publish_time`
- `Inläggstyp` → `post_type`
- `Permalänk` → `permalink`
- `Visningar` → `views`
- `Räckvidd` → `post_reach`
- `Gilla-markeringar` → `likes`
- `Kommentarer` → `comments`
- `Delningar` → `shares`
- `Följer` → `follows`
- `Sparade objekt` → `saves`

### Minneshantering

Appen innehåller sofistikerad minneshantering:
- `memoryUtils.js` beräknar och övervakar minnesanvändning
- `MemoryIndicator.jsx` visar minnesanvändning visuellt med varningsnivåer
- `webStorageService.js` hanterar lagring och optimerar mellan localStorage och IndexedDB
- Funktionalitet för att beräkna projicerad minnesanvändning innan nya filer läggs till
- Automatisk detektering av minnesgränser och varningar

## Dataflöde

1. Användaren väljer en eller flera CSV-filer via FileUploader
2. Varje fil analyseras (rad- och kolumnantal, filstorlek)
3. Filerna bearbetas sekventiellt av `webDataProcessor.js`
4. Kolumnnamn matchas mot hårdkodade mappningar i `columnConfig.js`
5. Dubletter filtreras baserat på post_id + fil-identifierare
6. Bearbetad data sparas i IndexedDB och localStorage via `webStorageService.js`
7. MainView renderar AccountView, PostView, PostTypeView eller TrendAnalysisView

## Lagring

Appen använder två metoder:
- **localStorage** för konfigurationer och metadata om uppladdade filer
- **IndexedDB** för större datamängder som bearbetad statistikdata

Data som lagras inkluderar:
- Bearbetad inläggsdata (post view data)
- Aggregerad kontodata (account view data)
- Filmetadata för uppladdade filer
- Minnesanvändningsstatistik

## Anpassning och konfiguration

- **Kolumnmappningar**: Ändra direkt i `src/utils/columnConfig.js` (ingen editor-UI)
- Valda fält för visning i AccountView, PostView och PostTypeView via checkboxar
- TrendAnalysisView har eget inbyggt val av mätvärde och konton
- Exportformat (CSV/Excel)
- Sortering och filtrering
- Sidstorlek för paginering

## Utvecklingsöverväganden

- **Prestanda**: Appen hanterar minnesbegränsningar i webbläsaren genom noggrann övervakning
- **Robusthet**: Felhantering och felåterhämtning är implementerade på flera nivåer
- **Användarvänlighet**: Gränssnittet ger tydlig feedback om fel och minnesbegränsningar
- **Webbplattform**: Appen är byggd för webben med emulerad Electron-funktionalitet
