# API-Reach – Implementationsplan

> Denna funktion lägger till stöd för att importera kontonivå-räckvidd från Metas Graph API-export (Facebook). Läs hela planen NOGGRANT innan du gör något. Bekräfta att du förstått varje fas innan implementation.

## Bakgrund

Meta Business Suite exporterar post-level CSV (per inlägg) som appen redan hanterar. Men "Räckvidd" (reach) på kontonivå — det totala antalet unika personer som nått av kontots innehåll under en månad — kan INTE beräknas från post-data. Det går bara att hämta via Metas Graph API, som exporterar en separat CSV med en rad per konto.

### Viktiga begränsningar

1. **Reach är INTE summerbart.** Det kan bara visas per månad, aldrig aggregerat över flera månader (en person som nåtts i jan och feb räknas en gång per månad, men vi vet inte om det är samma person).
2. **Bara Facebook.** Instagram har inte denna data.
3. **Matchning sker på kontonamn** (`Page` i API-CSV ↔ `account_name` i posts-tabellen). Page ID i API-CSV matchar INTE Sid-id i post-CSV — de är helt olika ID-system.
4. **Placeholder-konton ska filtreras bort.** Konton vars namn matchar `/^srholder/i` (t.ex. "Srholder8a", "SRholder9", "Srholder8e") ska ignoreras vid import och aldrig visas.

### API-CSV format

```
Page,Page ID,Reach,Engaged Users,Engagements,Reactions,Publications,Status,Comment
Sveriges Radio,146516072147644,3244571,0,916707,82009,66,OK,
P4 Extra,299358359881,3094100,0,1064312,96429,110,OK,
SRholder9b,874990382374946,0,0,0,0,0,NO_DATA,Alla värden är noll
```

Vi importerar BARA `Page` (kontonamn), `Page ID`, `Reach`, och `Status`. Övriga fält ignoreras (de överlappar med post-data men matchar inte exakt, vilket skapar förvirring).

---

## Fas 1: Databasschema

### Ny tabell

Skapa en SQL-migreringsfil `server/db/migrations/001_account_reach.sql`:

```sql
CREATE TABLE IF NOT EXISTS account_reach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  page_id TEXT,
  month TEXT NOT NULL,              -- 'YYYY-MM' format
  reach INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT DEFAULT (datetime('now')),
  source_filename TEXT,

  UNIQUE(account_name, month)       -- En rad per konto per månad
);

CREATE INDEX IF NOT EXISTS idx_account_reach_month ON account_reach(month);
CREATE INDEX IF NOT EXISTS idx_account_reach_name ON account_reach(account_name);
```

`UNIQUE(account_name, month)` innebär att reimport av samma månad uppdaterar befintliga rader (UPSERT).

### Kontrollera

- [ ] Migreringen körs vid serverstart
- [ ] Tabellen skapas korrekt
- [ ] `schema_version` uppdateras

---

## Fas 2: Import av API-CSV

### Ny service: `server/services/reachImporter.js`

```javascript
import Papa from 'papaparse';
import { getDb } from '../db/connection.js';

/**
 * Detect if a CSV is an API-level reach export.
 * Returns true if headers contain "Page", "Page ID", "Reach".
 */
export function isReachCSV(headers) {
  if (!headers || !Array.isArray(headers)) return false;
  const headerSet = new Set(headers.map(h => h.trim()));
  return headerSet.has('Page') && headerSet.has('Page ID') && headerSet.has('Reach');
}

/**
 * Check if an account name is a placeholder account that should be filtered out.
 */
function isPlaceholderAccount(name) {
  if (!name) return true;
  return /^srholder/i.test(name.trim());
}

/**
 * Parse and import an API-level reach CSV.
 * The CSV has no date information — the month must be provided by the user.
 *
 * Returns { imported, skipped, month, accounts[] }
 */
export function importReachCSV(csvContent, month, filename) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('Månad måste anges i formatet YYYY-MM.');
  }

  const result = Papa.parse(csvContent, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (!result.data || result.data.length === 0) {
    throw new Error('Ingen data hittades i CSV-filen.');
  }

  const headers = Object.keys(result.data[0]);
  if (!isReachCSV(headers)) {
    throw new Error('Filen är inte en API-räckviddsexport. Förväntade kolumnerna Page, Page ID, Reach.');
  }

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO account_reach (account_name, page_id, month, reach, source_filename)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_name, month) DO UPDATE SET
      page_id = excluded.page_id,
      reach = excluded.reach,
      source_filename = excluded.source_filename,
      imported_at = datetime('now')
  `);

  let imported = 0;
  let skipped = 0;
  const accounts = [];

  db.transaction(() => {
    for (const row of result.data) {
      const pageName = (row['Page'] || '').trim();
      const pageId = row['Page ID'] ? String(row['Page ID']).trim() : null;
      const reach = parseInt(row['Reach'], 10) || 0;
      const status = (row['Status'] || '').trim();

      // Skip placeholder accounts
      if (isPlaceholderAccount(pageName)) {
        skipped++;
        continue;
      }

      // Skip NO_DATA rows
      if (status === 'NO_DATA') {
        skipped++;
        continue;
      }

      // Skip empty names
      if (!pageName) {
        skipped++;
        continue;
      }

      upsert.run(pageName, pageId, month, reach, filename || null);
      imported++;
      accounts.push({ name: pageName, reach });
    }
  })();

  return { imported, skipped, month, accounts };
}

/**
 * Get all months that have account_reach data.
 */
export function getReachMonths() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT month FROM account_reach ORDER BY month ASC
  `).all().map(r => r.month);
}

/**
 * Delete all reach data for a specific month.
 */
export function deleteReachMonth(month) {
  const db = getDb();
  return db.prepare('DELETE FROM account_reach WHERE month = ?').run(month);
}
```

### Nytt API-endpoint: Reach-import

Lägg till i `server/routes/imports.js` — ett nytt endpoint för reach-CSV. Det kan INTE använda samma `POST /api/imports` eftersom:
- API-CSVn har ingen datuminformation — månaden måste skickas som parameter
- Den ska inte skapa en rad i `imports`-tabellen (den är inte en post-import)

Lägg till i `server/routes/imports.js` (eller skapa `server/routes/reach.js` och registrera i `server/index.js`):

```javascript
import { isReachCSV, importReachCSV, getReachMonths, deleteReachMonth } from '../services/reachImporter.js';

// POST /api/reach — upload API-level reach CSV
// Expects multipart form with 'file' and 'month' (YYYY-MM)
router.post('/reach', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil bifogades.' });
  }

  const month = req.body.month;
  if (!month) {
    // Clean up temp file
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Månad (month) måste anges i formatet YYYY-MM.' });
  }

  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);

    const result = importReachCSV(csvContent, month, req.file.originalname);

    res.status(201).json({
      type: 'reach',
      month: result.month,
      imported: result.imported,
      skipped: result.skipped,
    });
  } catch (err) {
    // Clean up temp file if it still exists
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: err.message });
  }
});

// GET /api/reach/months — which months have reach data
router.get('/reach/months', (req, res) => {
  const months = getReachMonths();
  res.json({ months });
});

// DELETE /api/reach/:month — delete reach data for a month
router.delete('/reach/:month', (req, res) => {
  const result = deleteReachMonth(req.params.month);
  res.json({ deleted: result.changes });
});
```

ALTERNATIVT: Om du skapar en separat `server/routes/reach.js`, registrera den i `server/index.js`:
```javascript
import reachRouter from './routes/reach.js';
app.use('/api/reach', reachRouter);
```

### Kontrollera

- [ ] `POST /api/reach` med en API-CSV och `month=2026-01` importerar reach-data
- [ ] Placeholder-konton (Srholder*) filtreras bort
- [ ] NO_DATA-rader filtreras bort
- [ ] Reimport av samma månad uppdaterar befintliga rader
- [ ] `GET /api/reach/months` returnerar importerade månader
- [ ] `DELETE /api/reach/2026-01` raderar data för den månaden

---

## Fas 3: Reach-data i accounts-endpoint

### Ändra `server/routes/accounts.js`

Accounts-endpointet ska returnera reach-data PER MÅNAD om sådant finns. Lägg till en separat query som hämtar reach per konto per månad.

Lägg till EFTER att `accounts` och `totals` hämtats, men FÖRE `res.json(...)`:

```javascript
// Fetch account-level reach data if available
// Only for months that overlap with the requested period
let reachData = [];
const periodFilter = buildPeriodConditions(req.query);

if (periodFilter.conditions.length > 0) {
  // Extract which months are being requested
  let reachMonths = [];
  if (req.query.months) {
    reachMonths = req.query.months.split(',').map(m => m.trim());
  } else if (req.query.dateFrom && req.query.dateTo) {
    // Generate month list from date range
    const start = req.query.dateFrom.slice(0, 7); // YYYY-MM
    const end = req.query.dateTo.slice(0, 7);
    let current = start;
    while (current <= end) {
      reachMonths.push(current);
      const [y, m] = current.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      current = next;
    }
  }

  if (reachMonths.length > 0) {
    const placeholders = reachMonths.map(() => '?').join(',');
    reachData = db.prepare(`
      SELECT account_name, month, reach
      FROM account_reach
      WHERE month IN (${placeholders})
      ORDER BY account_name, month
    `).all(...reachMonths);
  }
} else {
  // No period filter — get all reach data
  reachData = db.prepare(`
    SELECT account_name, month, reach
    FROM account_reach
    ORDER BY account_name, month
  `).all();
}

// Group reach by account_name → { month: reach }
const reachByAccount = {};
for (const row of reachData) {
  if (!reachByAccount[row.account_name]) {
    reachByAccount[row.account_name] = {};
  }
  reachByAccount[row.account_name][row.month] = row.reach;
}

// Available reach months (only months that actually have data)
const reachMonthsAvailable = [...new Set(reachData.map(r => r.month))].sort();
```

Ändra response:

```javascript
res.json({
  accounts,
  totals,
  reachByAccount,            // { "P4 Extra": { "2026-01": 3094100, "2026-02": ... } }
  reachMonths: reachMonthsAvailable,  // ["2026-01", "2026-02"]
});
```

### Kontrollera

- [ ] `GET /api/accounts?months=2026-01` returnerar `reachByAccount` med data
- [ ] `GET /api/accounts?months=2026-01,2026-02` returnerar reach per månad
- [ ] `GET /api/accounts` utan period returnerar all reach-data
- [ ] Konton utan reach-data saknas i `reachByAccount` (inget `null`, bara frånvaro)

---

## Fas 4: Frontend — apiClient

### Lägg till i `src/utils/apiClient.js`

```javascript
// Reach imports
uploadReachCSV: (file, month) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('month', month);
  return fetch('/api/reach', { method: 'POST', body: formData }).then(handleResponse);
},
getReachMonths: () => fetch('/api/reach/months').then(handleResponse),
deleteReachMonth: (month) =>
  fetch(`/api/reach/${month}`, { method: 'DELETE' }).then(handleResponse),
```

---

## Fas 5: Frontend — FileUploader stöd för reach-CSV

### Ändra `FileUploader.jsx`

FileUploader ska auto-detektera om en fil är en API-reach-CSV (baserat på kolumner) och i så fall:
1. Visa en PlatformBadge med "FB" + en badge "Räckvidd" (så att det är tydligt att det är en annan typ av import)
2. Kräva att användaren anger vilken månad filen gäller (en dropdown med YYYY-MM)
3. Använda `api.uploadReachCSV()` istället för `api.uploadCSV()`

Auto-detektion: läs första raden av filen client-side med PapaParse (preview: 1). Om headers innehåller "Page", "Page ID", "Reach" → det är en reach-CSV.

Implementera detta i `addFiles`-funktionen:

```javascript
const addFiles = useCallback(async (newFiles) => {
  const csvFiles = Array.from(newFiles).filter(
    f => f.type === 'text/csv' || f.name.endsWith('.csv')
  );
  if (csvFiles.length === 0) return;

  const fileEntries = [];

  for (const file of csvFiles) {
    // Read first line to detect type
    const preview = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const Papa = window.Papa || require('papaparse');
        // PapaParse is already available since it's a dependency
        const result = Papa.parse(e.target.result, { header: true, preview: 1 });
        resolve(result.meta?.fields || []);
      };
      reader.readAsText(file.slice(0, 4096)); // Read only first 4KB
    });

    const isReach = preview.includes('Page') &&
                    preview.includes('Page ID') &&
                    preview.includes('Reach');

    fileEntries.push({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      status: FILE_STATUS.PENDING,
      error: null,
      result: null,
      fileType: isReach ? 'reach' : 'posts',  // ← NY
      reachMonth: '',                           // ← NY: användaren fyller i
    });
  }

  setFiles(prev => [...prev, ...fileEntries]);
}, []);
```

I fillistan, visa extra UI för reach-filer:

```jsx
{entry.fileType === 'reach' && entry.status === FILE_STATUS.PENDING && (
  <div className="mt-1 flex items-center gap-2">
    <span className="text-xs text-muted-foreground">Månad:</span>
    <input
      type="month"
      value={entry.reachMonth}
      onChange={(e) => {
        e.stopPropagation();
        setFiles(prev => prev.map(f =>
          f.id === entry.id ? { ...f, reachMonth: e.target.value } : f
        ));
      }}
      className="border border-input rounded px-2 py-0.5 text-xs"
      required
    />
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-300">
      Kontoräckvidd
    </span>
  </div>
)}
```

I `handleProcessFiles`, använd rätt API baserat på filtyp:

```javascript
if (entry.fileType === 'reach') {
  if (!entry.reachMonth) {
    throw new Error('Ange vilken månad räckviddsfilen gäller.');
  }
  result = await api.uploadReachCSV(entry.file, entry.reachMonth);
} else {
  result = await api.uploadCSV(entry.file);
}
```

### Kontrollera

- [ ] Dra in en API-reach-CSV → auto-detekteras som "Kontoräckvidd"
- [ ] Månadsfält visas för reach-filer
- [ ] Import fungerar med angiven månad
- [ ] Vanliga post-CSVer fungerar som förut
- [ ] Felmeddelande om månad inte anges

---

## Fas 6: Frontend — Dynamiska reach-kolumner i AccountView

### Princip

Appen ser att API-retur innehåller `reachByAccount` och `reachMonths`. Om `reachMonths` inte är tom och användaren har valt "Kontoräckvidd" som fält:

- **En vald månad** → EN extra kolumn: "Kontoräckvidd Jan 26"
- **Flera valda månader** → EN kolumn PER månad: "Kontoräckvidd Jan 26", "Kontoräckvidd Feb 26", "Kontoräckvidd Mar 26"
- **Ingen reach-data** → kolumnen visar "—" för alla konton

### Ändra AccountView.jsx

**Nytt fält i ACCOUNT_VIEW_AVAILABLE_FIELDS:**

```javascript
'account_reach': 'Kontoräckvidd (API)',
```

Lägg till EFTER `'average_reach': 'Genomsnittlig räckvidd'`.

**Nytt state för reach-data:**

```javascript
const [reachByAccount, setReachByAccount] = useState({});
const [reachMonths, setReachMonths] = useState([]);
```

Uppdatera useEffect som hämtar data — spara `reachByAccount` och `reachMonths` från API-svaret:

```javascript
const data = await api.getAccounts(params);
setAccountData(data.accounts || []);
setTotalSummary(data.totals || {});
setReachByAccount(data.reachByAccount || {});
setReachMonths(data.reachMonths || []);
```

**Formatera månadsnamn för kolumnrubriker:**

```javascript
const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

function formatReachColumnHeader(month) {
  const [year, m] = month.split('-');
  return `Räckvidd ${MONTH_NAMES_SV[parseInt(m, 10) - 1]} ${year.slice(2)}`;
}
```

**Dynamiska kolumner i TableHeader:**

Hitta raden `{selectedFields.map(field => ...)}` i TableHeader. EFTER den (eller inline som replacement för `account_reach`-fältet), rendera reach-kolumner:

```jsx
{selectedFields.includes('account_reach') && reachMonths.map(month => (
  <TableHead key={`reach-${month}`}>
    <div className="flex items-center justify-end whitespace-nowrap">
      {formatReachColumnHeader(month)}
      <PlatformBadge platform="facebook" />
    </div>
  </TableHead>
))}
```

**OBS:** Om `account_reach` är i selectedFields men reachMonths är tomt, visa EN kolumn med rubriken "Kontoräckvidd" och "—" i alla celler. Lägg till en liten infotext: "Ladda upp API-export för att se kontoräckvidd."

**Om `account_reach` INTE finns i selectedFields**, rendera inga reach-kolumner alls.

**Dynamiska celler i TableBody:**

I raden som renderar varje konto, EFTER `selectedFields.map(field => ...)`:

```jsx
{selectedFields.includes('account_reach') && reachMonths.map(month => {
  const reachMap = reachByAccount[account.account_name];
  const reachValue = reachMap ? reachMap[month] : undefined;

  return (
    <TableCell key={`reach-${month}`} className="text-right">
      {reachValue !== undefined ? (
        <div className="flex items-center justify-end group">
          <span>{formatValue(reachValue)}</span>
          <CopyButton value={reachValue} field={`reach-${month}`} rowId={account.account_id} />
        </div>
      ) : (
        <span
          className="text-muted-foreground cursor-help"
          title="Kontoräckvidd saknas för denna månad"
        >
          —
        </span>
      )}
    </TableCell>
  );
})}
```

**Ingen reach i reachMonths?** Visa en ensam kolumn med alla streck:

```jsx
{selectedFields.includes('account_reach') && reachMonths.length === 0 && (
  <TableCell className="text-right">
    <span className="text-muted-foreground text-xs">Saknas</span>
  </TableCell>
)}
```

**Totalraden:** Reach kan INTE summeras. Visa "—" i total-radens reach-kolumner:

```jsx
{selectedFields.includes('account_reach') && reachMonths.map(month => (
  <TableCell key={`total-reach-${month}`} className="text-right font-semibold text-primary">
    —
  </TableCell>
))}
```

**Hantera `account_reach` i vanliga selectedFields-loopen:**

I selectedFields.map(...) som renderar vanliga kolumner, HOPPA ÖVER `account_reach` — det hanteras separat:

```javascript
{selectedFields.filter(f => f !== 'account_reach').map(field => (
  // ... befintlig rendering
))}
```

Gör samma sak i TableHeader och totalraden.

**Sortering på reach-kolumner:**

Varje reach-kolumnrubrik ska vara klickbar och sortera på den månadens reach:

```jsx
<TableHead
  key={`reach-${month}`}
  className="cursor-pointer hover:bg-muted/50"
  onClick={() => setSortConfig({ key: `reach_${month}`, direction: sortConfig.key === `reach_${month}` && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
>
```

Sorteringen sker client-side (reach finns redan i `reachByAccount`). I den befintliga sorteringslogiken (eller paginatedData-memot), hantera `reach_*`-nycklar:

```javascript
const paginatedData = useMemo(() => {
  let sorted = [...accountData];

  if (sortConfig.key) {
    sorted.sort((a, b) => {
      let aVal, bVal;

      if (sortConfig.key.startsWith('reach_')) {
        const month = sortConfig.key.replace('reach_', '');
        aVal = reachByAccount[a.account_name]?.[month] ?? -1;
        bVal = reachByAccount[b.account_name]?.[month] ?? -1;
      } else {
        aVal = a[sortConfig.key];
        bVal = b[sortConfig.key];
      }

      if (aVal == null) aVal = -1;
      if (bVal == null) bVal = -1;

      return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }

  const startIndex = (currentPage - 1) * pageSize;
  return sorted.slice(startIndex, startIndex + pageSize);
}, [accountData, sortConfig, currentPage, pageSize, reachByAccount]);
```

**OBS:** Sorteringen sker nu client-side för ALLA fält i AccountView (inte bara reach). Det är ok — AccountView hämtar redan alla konton från servern och paginerar client-side.

**Export (CSV/Excel):**

I `formatDataForExport`, lägg till reach-kolumner:

```javascript
if (selectedFields.includes('account_reach')) {
  for (const month of reachMonths) {
    const headerName = formatReachColumnHeader(month);
    const reachMap = reachByAccount[account.account_name];
    formatted[headerName] = reachMap?.[month] !== undefined
      ? formatValue(reachMap[month])
      : '—';
  }
}
```

### Kontrollera

- [ ] "Kontoräckvidd (API)" visas som valbar checkbox i fältväljaren
- [ ] Med en månad vald: en kolumn med reach-data
- [ ] Med tre månader valda: tre kolumner med rätt månadsrubriker
- [ ] Konton utan reach-data visar "—" med mouseover-text
- [ ] Instagram-konton visar "—" (de har aldrig API-reach)
- [ ] Totalraden visar "—" för alla reach-kolumner
- [ ] Sortering på reach-kolumner fungerar
- [ ] Export inkluderar reach-kolumner
- [ ] Om ingen reach-data finns alls: en kolumn med "Saknas"

---

## Fas 7: Frontend — Reach i ImportManager

I `ImportManager.jsx`, lägg till en sektion som visar importerad räckviddsdata:

```jsx
// Hämta reach-månader
const [reachMonths, setReachMonths] = useState([]);

// I fetchData():
const reachMonthsData = await api.getReachMonths().catch(() => ({ months: [] }));
setReachMonths(reachMonthsData.months || []);
```

Visa en sektion i ImportManager (efter import-tabellen):

```jsx
{reachMonths.length > 0 && (
  <Card>
    <CardHeader>
      <CardTitle className="text-lg">Kontoräckvidd (Facebook API)</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="flex flex-wrap gap-2">
        {reachMonths.map(month => (
          <div key={month} className="flex items-center gap-1 px-3 py-1.5 rounded border bg-blue-50 border-blue-200 text-blue-800 text-sm font-medium">
            {month}
            <button
              onClick={() => {
                if (confirm(`Radera räckviddsdata för ${month}?`)) {
                  api.deleteReachMonth(month).then(fetchData);
                }
              }}
              className="ml-1 hover:text-red-600"
              title="Radera"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Räckviddsdata importerad från Metas Graph API. Gäller bara Facebook.
      </p>
    </CardContent>
  </Card>
)}
```

---

## Fas 8: Plattformsbadge på fältet

I MainView.jsx ValueSelector, lägg till FB-badge för `account_reach`:

```javascript
{key === 'account_reach' && <PlatformBadge platform="facebook" />}
```

Och i ACCOUNT_VIEW_AVAILABLE_FIELDS:
```javascript
'account_reach': 'Kontoräckvidd (API)',
```

Fältet ska INTE visas om plattformsfiltret är satt till "instagram" (det finns ingen reach-data för IG). Använd samma logik som för FB_ONLY_FIELDS:

Lägg till `'account_reach'` i FB_ONLY_FIELDS-arrayen i MainView.jsx:
```javascript
const FB_ONLY_FIELDS = ['total_clicks', 'link_clicks', 'other_clicks', 'account_reach'];
```

---

## Fas 9: Visa konton utan publiceringar (toggle)

Konton som finns i `account_reach` men INTE i `posts` visas inte i AccountView (de saknas i `accounts`-arrayen). Lägg till en toggle:

**I AccountView.jsx:**

```javascript
const [showReachOnlyAccounts, setShowReachOnlyAccounts] = useState(false);
```

**I accounts-endpointet** (`server/routes/accounts.js`), lägg till en parameter `includeReachOnly=true` som UNION:ar in konton som bara finns i `account_reach`:

```javascript
if (req.query.includeReachOnly === 'true' && reachMonths.length > 0) {
  const reachOnlyAccounts = db.prepare(`
    SELECT DISTINCT ar.account_name
    FROM account_reach ar
    WHERE ar.month IN (${reachMonths.map(() => '?').join(',')})
    AND ar.account_name NOT IN (
      SELECT DISTINCT account_name FROM posts
      ${whereClause ? whereClause : ''}
    )
    AND ar.account_name NOT LIKE 'SRholder%'
    AND ar.account_name NOT LIKE 'srholder%'
  `).all(...reachMonths, ...params);

  for (const row of reachOnlyAccounts) {
    accounts.push({
      account_id: null,
      account_name: row.account_name,
      account_username: null,
      platform: 'facebook',
      is_collab: 0,
      post_count: 0,
      views: 0, reach: 0, likes: 0, comments: 0, shares: 0,
      total_clicks: 0, link_clicks: 0, other_clicks: 0,
      saves: 0, follows: 0, interactions: 0, engagement: 0,
      posts_per_day: 0,
      _reachOnly: true,
    });
  }
}
```

**I AccountView UI**, visa toggle bara om `account_reach` är i selectedFields:

```jsx
{selectedFields.includes('account_reach') && (
  <div className="flex items-center gap-2 mb-2">
    <Switch
      id="show-reach-only"
      checked={showReachOnlyAccounts}
      onCheckedChange={setShowReachOnlyAccounts}
    />
    <Label htmlFor="show-reach-only" className="text-sm">
      Visa konton utan publiceringar (bara räckvidd)
    </Label>
  </div>
)}
```

Skicka `includeReachOnly` till API:et:

```javascript
if (showReachOnlyAccounts && selectedFields.includes('account_reach')) {
  params.includeReachOnly = 'true';
}
```

Reach-only konton ska vara visuellt nedtonade i tabellen (liknande collab):

```jsx
<TableRow className={account._reachOnly ? 'bg-gray-50/50 opacity-60' : account.is_collab ? 'bg-amber-50/50 opacity-75' : ''}>
```

### Kontrollera

- [ ] Toggle visas bara när "Kontoräckvidd" är valt
- [ ] Av-default: konton utan poster visas INTE
- [ ] Toggle på: konton utan poster visas med reach-data men nollor i allt annat
- [ ] Reach-only konton är visuellt nedtonade
- [ ] Placeholder-konton visas ALDRIG

---

## Ordning

1. **Fas 1** — DB-schema (migrering)
2. **Fas 2** — Import-service + API-endpoint
3. **Fas 3** — Accounts-endpoint utökat med reach
4. **Fas 4** — apiClient utökat
5. **Fas 5** — FileUploader auto-detektion
6. **Fas 6** — AccountView dynamiska kolumner (STÖRST — mest komplex)
7. **Fas 7** — ImportManager reach-sektion
8. **Fas 8** — Badge + fältfiltrering
9. **Fas 9** — Reach-only konton (toggle)

## Regler

- Ändra INTE befintlig post-import, post-level reach, eller `posts`-tabellen
- `account_reach` är en HELT SEPARAT tabell — ingen foreign key till posts
- Matchning på `account_name` — case-sensitive exakt matchning
- Placeholder-konton (`/^srholder/i`) ska ALDRIG importeras eller visas NÅGONSTANS
- `NO_DATA`-rader i API-CSVn ska inte importeras
- Reach kan INTE summeras — totalraden visar alltid "—"
- Testa med riktiga CSV-filer efter varje fas
- Bekräfta med mig innan nästa fas
