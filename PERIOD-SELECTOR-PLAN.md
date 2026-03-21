# Periodväljare – Implementationsplan

> Läs denna plan NOGGRANT innan du gör något. Bekräfta att du förstått varje fas innan implementation.

## Bakgrund

Med persistent SQLite-databas behöver användaren kunna välja vilken tidsperiod som ska visas. CSV-filerna från Meta har dagsprecision (publish_time med datum och klockslag). Användaren laddar upp hela månader, men databasen växer över tid.

### Designbeslut (redan fattade)

1. **Två lägen med toggle:** "Månader" (default) och "Anpassad period" (from/to datumfält). Lägena ersätter varandra — man ser antingen månadspills eller datumfält, aldrig båda.
2. **Default vid start:** Senaste månaden som finns i databasen förvald.
3. **Placering:** I MainView, direkt under rubrik + plattformsfilter, ovanför flikarna. Alltid synlig.
4. **Alla API-endpoints** ska stödja periodfiltrering via query-params.

---

## Fas 1: API-stöd för periodfiltrering

### Vad som ska ändras

Alla fem rout-filer som läser posts-tabellen ska stödja **två alternativa filtreringsmetoder**:

- **`months`** — kommaseparerad lista: `months=2026-01,2026-02`
- **`dateFrom` + `dateTo`** — exakta datum: `dateFrom=2026-02-01&dateTo=2026-02-28`

Om båda skickas: `dateFrom`/`dateTo` tar företräde (ignorera `months`).
Om inget skickas: ingen periodfiltrering (visa allt).

### Gemensam hjälpfunktion

Skapa ny fil `server/utils/periodFilter.js`:

```javascript
/**
 * Build SQL WHERE conditions for period filtering.
 * Returns { conditions: string[], params: any[] } to append to existing WHERE.
 *
 * Supports two modes:
 * 1. dateFrom/dateTo — exact date range (takes precedence)
 * 2. months — comma-separated list of YYYY-MM strings
 *
 * If neither is provided, returns empty (no filtering).
 */
export function buildPeriodConditions(query) {
  const conditions = [];
  const params = [];

  const { dateFrom, dateTo, months } = query;

  if (dateFrom && dateTo) {
    // Exact date range. Use >= dateFrom and < dateTo+1 day to include all of dateTo.
    // The frontend sends dateTo as the last day to include (e.g. 2026-02-28).
    // We compare as strings — publish_time is stored as 'YYYY-MM-DD HH:MM:SS'.
    conditions.push("publish_time >= ?");
    params.push(`${dateFrom} 00:00:00`);
    conditions.push("publish_time <= ?");
    params.push(`${dateTo} 23:59:59`);
  } else if (dateFrom) {
    conditions.push("publish_time >= ?");
    params.push(`${dateFrom} 00:00:00`);
  } else if (dateTo) {
    conditions.push("publish_time <= ?");
    params.push(`${dateTo} 23:59:59`);
  } else if (months) {
    // months is a comma-separated string: "2026-01,2026-02"
    const monthList = months.split(',').map(m => m.trim()).filter(Boolean);
    if (monthList.length > 0) {
      const placeholders = monthList.map(() => '?').join(',');
      conditions.push(`strftime('%Y-%m', publish_time) IN (${placeholders})`);
      params.push(...monthList);
    }
  }

  return { conditions, params };
}
```

### Ändra varje route-fil

I varje route som bygger WHERE-villkor, importera `buildPeriodConditions` och infoga villkoren. Mönstret är identiskt i alla filer:

**Filer att ändra:**
- `server/routes/posts.js`
- `server/routes/accounts.js`
- `server/routes/postTypes.js`
- `server/routes/trends.js`

I varje fil, hitta raden där `conditions` och `params` byggs upp (t.ex. `const conditions = [];`). DIREKT EFTER att conditions-arrayen skapats, lägg till:

```javascript
import { buildPeriodConditions } from '../utils/periodFilter.js';

// ... inne i route-handleren, efter const conditions = []; const params = [];

// Period filtering
const periodFilter = buildPeriodConditions(req.query);
conditions.push(...periodFilter.conditions);
params.push(...periodFilter.params);
```

**Undantag – `trends.js`:** Här har conditions redan `'publish_time IS NOT NULL'` som första villkor. Periodvillkoren läggs till EFTER det, inget speciellt behövs.

### Ändra coverage-endpoint

`server/routes/imports.js` — `GET /api/imports/coverage` behöver INTE periodfiltrering (den visar ju vilka månader som FINNS). Ingen ändring behövs.

### Kontrollera

- [ ] `GET /api/posts?months=2026-02` returnerar bara februari-poster
- [ ] `GET /api/accounts?months=2026-01,2026-02` returnerar aggregering för jan+feb
- [ ] `GET /api/posts?dateFrom=2026-02-10&dateTo=2026-02-20` returnerar bara poster 10–20 feb
- [ ] `GET /api/posts` (utan period-params) returnerar allt som förut
- [ ] `GET /api/trends?months=2026-02&metric=views&accounts=...` returnerar bara feb-data
- [ ] Alla endpoints fungerar som förut om inga period-params skickas

---

## Fas 2: Ny komponent – PeriodSelector

### Var

Skapa `src/renderer/components/PeriodSelector/PeriodSelector.jsx` och `src/renderer/components/PeriodSelector/index.js`.

### Props

```javascript
PeriodSelector({
  availableMonths,   // Array<{ month: string, post_count: number, has_facebook: boolean, has_instagram: boolean }>
  selectedMonths,    // string[] — t.ex. ['2026-02']
  onMonthsChange,    // (months: string[]) => void
  customRange,       // { from: string, to: string } | null
  onCustomRangeChange, // (range: { from: string, to: string } | null) => void
  mode,              // 'months' | 'custom'
  onModeChange,      // (mode: 'months' | 'custom') => void
})
```

### UI-struktur

```
┌─────────────────────────────────────────────────────────────────────┐
│  📅 Period:  [Månader ◉ | ○ Anpassad]   [Välj alla] [Rensa]       │
│                                                                     │
│  Månadsläge:                                                        │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                     │
│  │Jan 26│ │Feb 26│ │Mar 26│ │Apr 26│ │Maj 26│  ...                 │
│  │ (84) │ │(4590)│ │(3200)│ │  —   │ │(2100)│                     │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                     │
│    vald     vald                                                    │
│                                                                     │
│  ELLER Anpassat läge:                                               │
│  Från: [2026-02-01]  Till: [2026-02-28]                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Implementation

```jsx
import React from 'react';
import { Calendar, SlidersHorizontal } from 'lucide-react';
import { Button } from '../ui/button';

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

function formatMonthLabel(monthStr) {
  // "2026-02" → "Feb 26"
  const [year, month] = monthStr.split('-');
  const monthName = MONTH_NAMES_SV[parseInt(month, 10) - 1] || month;
  return `${monthName} ${year.slice(2)}`;
}

const PeriodSelector = ({
  availableMonths,
  selectedMonths,
  onMonthsChange,
  customRange,
  onCustomRangeChange,
  mode,
  onModeChange,
}) => {

  const handleToggleMonth = (month) => {
    if (selectedMonths.includes(month)) {
      // Don't allow deselecting the last month
      if (selectedMonths.length === 1) return;
      onMonthsChange(selectedMonths.filter(m => m !== month));
    } else {
      onMonthsChange([...selectedMonths, month].sort());
    }
  };

  const handleSelectAll = () => {
    onMonthsChange(availableMonths.map(m => m.month));
  };

  const handleSelectLatest = () => {
    if (availableMonths.length === 0) return;
    const sorted = [...availableMonths].sort((a, b) => b.month.localeCompare(a.month));
    onMonthsChange([sorted[0].month]);
  };

  const allSelected = availableMonths.length > 0 &&
    selectedMonths.length === availableMonths.length;

  if (!availableMonths || availableMonths.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-border rounded-lg p-4 space-y-3">
      {/* Header row: icon, mode toggle, action buttons */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Calendar className="h-4 w-4" />
            Period
          </div>

          {/* Mode toggle */}
          <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
            <button
              onClick={() => onModeChange('months')}
              className={`px-3 py-1.5 font-medium transition-colors ${
                mode === 'months'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white text-muted-foreground hover:bg-muted/50'
              }`}
            >
              Månader
            </button>
            <button
              onClick={() => onModeChange('custom')}
              className={`px-3 py-1.5 font-medium transition-colors border-l border-border ${
                mode === 'custom'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 inline mr-1" />
              Anpassad
            </button>
          </div>
        </div>

        {/* Action buttons (months mode only) */}
        {mode === 'months' && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={allSelected ? handleSelectLatest : handleSelectAll}
              className="text-xs"
            >
              {allSelected ? 'Senaste' : 'Alla'}
            </Button>
          </div>
        )}
      </div>

      {/* Month pills */}
      {mode === 'months' && (
        <div className="flex flex-wrap gap-2">
          {availableMonths.map(({ month, post_count, has_facebook, has_instagram }) => {
            const isSelected = selectedMonths.includes(month);
            // Color coding: purple = both, blue = FB, pink = IG
            let activeClass = 'bg-primary text-primary-foreground';
            if (isSelected && has_facebook && has_instagram) {
              activeClass = 'bg-purple-600 text-white';
            } else if (isSelected && has_instagram && !has_facebook) {
              activeClass = 'bg-pink-600 text-white';
            } else if (isSelected && has_facebook && !has_instagram) {
              activeClass = 'bg-blue-600 text-white';
            }

            return (
              <button
                key={month}
                onClick={() => handleToggleMonth(month)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                  isSelected
                    ? `${activeClass} border-transparent`
                    : 'bg-white text-gray-600 border-gray-300 hover:border-primary/60 hover:bg-gray-50'
                }`}
              >
                <span className="block">{formatMonthLabel(month)}</span>
                <span className={`block text-xs ${isSelected ? 'opacity-80' : 'text-gray-400'}`}>
                  {post_count.toLocaleString('sv-SE')}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Custom date range */}
      {mode === 'custom' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Från:</label>
            <input
              type="date"
              value={customRange?.from || ''}
              onChange={(e) => onCustomRangeChange({
                from: e.target.value,
                to: customRange?.to || ''
              })}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Till:</label>
            <input
              type="date"
              value={customRange?.to || ''}
              onChange={(e) => onCustomRangeChange({
                from: customRange?.from || '',
                to: e.target.value
              })}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PeriodSelector;
```

Skapa `src/renderer/components/PeriodSelector/index.js`:

```javascript
export { default } from './PeriodSelector';
```

### Kontrollera

- [ ] Komponenten renderar månadspills korrekt
- [ ] Toggle mellan Månader och Anpassad fungerar
- [ ] Multi-select: klicka på flera månader, de highlightas
- [ ] Kan inte avmarkera sista månaden (minst en måste vara vald)
- [ ] "Alla"-knapp väljer alla, blir "Senaste" när alla är valda
- [ ] Datumfält visas och uppdateras i Anpassat läge

---

## Fas 3: Integration i MainView

### State-ändringar i MainView.jsx

Lägg till nya state-variabler (efter befintliga useState-anrop):

```javascript
// Period selection
const [periodMode, setPeriodMode] = useState('months'); // 'months' | 'custom'
const [selectedMonths, setSelectedMonths] = useState([]);
const [customRange, setCustomRange] = useState({ from: '', to: '' });
const [coverageData, setCoverageData] = useState([]);
```

### Hämta coverage och sätt default

I den befintliga `useEffect` som hämtar stats och imports, lägg till coverage-hämtning och default-val:

```javascript
useEffect(() => {
  const loadData = async () => {
    try {
      const [statsData, importsData, coverageResult] = await Promise.all([
        api.getStats(),
        api.getImports(),
        api.getCoverage().catch(() => ({ months: [] })),
      ]);
      setStats(statsData);
      setImports(importsData);

      const months = coverageResult.months || [];
      setCoverageData(months);

      // Default: select latest month
      if (months.length > 0 && selectedMonths.length === 0) {
        const sorted = [...months].sort((a, b) => b.month.localeCompare(a.month));
        setSelectedMonths([sorted[0].month]);
      }
    } catch (error) {
      console.error('Fel vid laddning:', error);
    }
  };
  loadData();
}, []);
```

### Beräkna API-period-params

Lägg till ett memo som räknar ut vilka query-params som ska skickas:

```javascript
const periodParams = useMemo(() => {
  if (periodMode === 'custom' && customRange.from && customRange.to) {
    return { dateFrom: customRange.from, dateTo: customRange.to };
  }
  if (periodMode === 'months' && selectedMonths.length > 0) {
    return { months: selectedMonths.join(',') };
  }
  return {}; // no filter (show all)
}, [periodMode, selectedMonths, customRange]);
```

### Uppdatera period-info-raden

Ersätt den befintliga `hasDateRange`-raden (med CalendarIcon) med `PeriodSelector`:

```jsx
import PeriodSelector from '../PeriodSelector';

// Ta bort:
// {hasDateRange && activeView !== 'imports' && ( ... CalendarIcon ... )}

// Lägg till OVANFÖR <Tabs ...>:
{activeView !== 'imports' && coverageData.length > 0 && (
  <PeriodSelector
    availableMonths={coverageData}
    selectedMonths={selectedMonths}
    onMonthsChange={setSelectedMonths}
    customRange={customRange}
    onCustomRangeChange={setCustomRange}
    mode={periodMode}
    onModeChange={setPeriodMode}
  />
)}
```

### Skicka periodParams till alla vyer

Varje vy-komponent behöver `periodParams`. Ändra props:

```jsx
<TabsContent value="account">
  <AccountView selectedFields={selectedFields} platform={apiPlatform} periodParams={periodParams} />
</TabsContent>

<TabsContent value="post">
  <PostView selectedFields={selectedFields} platform={apiPlatform} periodParams={periodParams} />
</TabsContent>

<TabsContent value="post_type">
  <PostTypeView selectedFields={selectedFields} platform={apiPlatform} periodParams={periodParams} />
</TabsContent>

<TabsContent value="trend_analysis">
  <TrendAnalysisView platform={apiPlatform} periodParams={periodParams} />
</TabsContent>
```

### Uppdatera varje vy-komponent

I **AccountView.jsx**, **PostView.jsx**, **PostTypeView.jsx**, **TrendAnalysisView.jsx**: ta emot `periodParams` som prop och inkludera det i alla API-anrop.

Mönstret är identiskt i alla filer. Hitta varje `fetch`/`api.*`-anrop och sprid `periodParams` i params-objektet.

**Exempel — AccountView.jsx:**

Ändra props:
```javascript
const AccountView = ({ selectedFields, platform, periodParams }) => {
```

Hitta `useEffect` som hämtar data (raden med `api.getAccounts`). Ändra params:
```javascript
const params = {
  fields: selectedFields.join(','),
  sort: sortConfig.key || 'views',
  order: sortConfig.direction || 'desc',
  ...periodParams,  // ← LÄGG TILL
};
if (platform) params.platform = platform;
```

Lägg till `periodParams` i dependency-arrayen:
```javascript
}, [selectedFields, platform, sortConfig, periodParams]);
```

**Samma mönster för PostView.jsx** — sprid `...periodParams` i params-objektet i alla `api.getPosts()`- och `api.getAccounts()`-anrop. Lägg till `periodParams` i dependency-arrays.

**Samma mönster för PostTypeView.jsx** — sprid `...periodParams` i `api.getPostTypes()`- och `api.getAccounts()`-anrop.

**TrendAnalysisView.jsx** — sprid `...periodParams` i `api.getAccounts()`- och `api.getTrends()`-anrop.

### Uppdatera coverage efter import

I `handleImportsChanged` (MainView), hämta coverage på nytt:

```javascript
const handleImportsChanged = async () => {
  try {
    const [statsData, importsData, coverageResult] = await Promise.all([
      api.getStats(),
      api.getImports(),
      api.getCoverage().catch(() => ({ months: [] })),
    ]);
    setStats(statsData);
    setImports(importsData);
    setCoverageData(coverageResult.months || []);

    // Om nya månader dykt upp, behåll befintligt val
    // (inget behov att ändra selectedMonths)
  } catch (error) {
    console.error('Fel vid uppdatering:', error);
  }
};
```

### Kontrollera

- [ ] PeriodSelector syns ovanför flikarna
- [ ] Byta månad → tabeller uppdateras
- [ ] Byta till "Anpassad" → datumfält visas, månadspills försvinner
- [ ] Välja datumintervall → data filtreras korrekt
- [ ] Byta tillbaka till "Månader" → senast valda månader syns
- [ ] Importera ny fil → coverage uppdateras med ny månad
- [ ] Allt fungerar ihop med plattformsfiltret
- [ ] Alla fyra vyer (konto, inlägg, inläggstyp, trend) respekterar perioden

---

## Ordning

1. **Fas 1 först** — `server/utils/periodFilter.js` + ändra alla routes. Testa med curl/browser.
2. **Fas 2** — Skapa `PeriodSelector`-komponenten. Rendera den isolerat om du vill.
3. **Fas 3 sist** — Integrera i MainView, skicka periodParams till alla vyer.

## Regler

- Ändra INTE databasschema, csvProcessor, collabDetector
- Alla period-params är VALFRIA — utan dem fungerar allt som förut (ingen regression)
- `periodFilter.js` är en ren hjälpfunktion utan sidoeffekter
- PeriodSelector är en ren komponent — all state hanteras av MainView
- Testa med riktiga CSV-filer efter varje fas
- Bekräfta med mig innan nästa fas
- Bryt inte export-funktionalitet (CSV/Excel ska exportera det som visas, dvs filtrerad data)
