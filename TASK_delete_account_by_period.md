# TASK: Radera konto från vald period (AccountView)

## Sammanfattning

Lägg till möjlighet att radera alla poster för ett specifikt konto+plattform inom den valda tidsperioden, direkt från kontovyn. Funktionen ska vara dold by default och kräva bekräftelse. Syftet är att enkelt kunna ta bort samarbetskonton och spilldata (t.ex. konton med 0 i räckvidd som dyker upp i Meta Business Suite-exporter).

**Scope:** Enbart poster i `posts`-tabellen. Reach-data (`account_reach`) och GA-lyssningar (`ga_listens`) ska INTE påverkas.

---

## 1. Backend: Ny endpoint

### Fil: `server/routes/posts.js`

Lägg till en ny `DELETE`-endpoint:

```
DELETE /api/posts/by-account?accountName=X&platform=facebook&months=2026-01,2026-02
```

**Parametrar (alla obligatoriska):**
- `accountName` — kontonamn (exakt match)
- `platform` — `facebook` eller `instagram`
- Periodfilter: antingen `months` (kommaseparerad) ELLER `dateFrom` + `dateTo` — exakt samma format som övriga endpoints redan använder

**Implementation:**
1. Validera att `accountName` och `platform` finns, returnera 400 annars
2. Validera att minst ett periodfilter finns (months eller dateFrom/dateTo), returnera 400 annars — detta förhindrar att man av misstag raderar ALLA poster för ett konto
3. Bygg WHERE-villkor med `buildPeriodConditions(req.query)` från `server/utils/periodFilter.js` (redan finns och används av alla andra routes)
4. Lägg till `account_name = ?` och `platform = ?` till villkoren
5. Kör `DELETE FROM posts WHERE [villkor]` — returnera `{ deleted: result.changes }`
6. Kör `redetectAllCollabs()` efter (importera från `server/services/collabDetector.js`)

**Exempelimplementation:**

```js
// DELETE /api/posts/by-account
router.delete('/by-account', (req, res) => {
  const db = getDb();
  const { accountName, platform } = req.query;

  if (!accountName || !platform) {
    return res.status(400).json({ error: 'accountName och platform krävs.' });
  }

  if (!['facebook', 'instagram'].includes(platform)) {
    return res.status(400).json({ error: 'Ogiltig plattform.' });
  }

  const periodFilter = buildPeriodConditions(req.query);
  if (periodFilter.conditions.length === 0) {
    return res.status(400).json({ error: 'Periodfilter krävs (months eller dateFrom/dateTo).' });
  }

  const conditions = [
    'account_name = ?',
    'platform = ?',
    ...periodFilter.conditions,
  ];
  const params = [accountName, platform, ...periodFilter.params];

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const countBefore = db.prepare(
    `SELECT COUNT(*) AS count FROM posts ${whereClause}`
  ).get(...params).count;

  if (countBefore === 0) {
    return res.status(404).json({ error: 'Inga poster hittades för angivna filter.' });
  }

  const result = db.prepare(`DELETE FROM posts ${whereClause}`).run(...params);

  // Re-run collab detection
  const { redetectAllCollabs } = await import('../services/collabDetector.js');
  // OBS: redetectAllCollabs är synkron, inte async — kalla direkt
  redetectAllCollabs();

  res.json({ deleted: result.changes, accountName, platform });
});
```

**OBS:** `redetectAllCollabs` importeras redan dynamiskt i `maintenance.js` — följ samma mönster, eller importera statiskt högst upp (renare). Kontrollera att funktionen är synkron (det är den — den använder `better-sqlite3` som är synkront).

---

## 2. Frontend: API-klient

### Fil: `src/utils/apiClient.js`

Lägg till i `api`-objektet:

```js
deleteAccountPosts: (accountName, platform, periodParams) => {
  const params = new URLSearchParams({
    accountName,
    platform,
    ...periodParams,
  });
  return fetch(`/api/posts/by-account?${params}`, { method: 'DELETE' })
    .then(handleResponse);
},
```

---

## 3. Frontend: AccountView — toggle + raderingskolumn

### Fil: `src/renderer/components/AccountView/AccountView.jsx`

### 3a. Ny state-variabel

```js
const [showDeleteColumn, setShowDeleteColumn] = useState(false);
const [deleteConfirm, setDeleteConfirm] = useState(null); // { accountName, platform } eller null
const [deleteLoading, setDeleteLoading] = useState(false);
```

### 3b. Toggle-knapp i verktygsfältet

Placera i samma `div` som CSV/Excel-knapparna (rad med `flex items-center justify-between mb-4`). Lägg till till vänster, bredvid den befintliga reach-only-switchen:

```jsx
<div className="flex items-center gap-4">
  {/* Befintlig reach-only switch ... */}
  <div className="flex items-center gap-2">
    <Switch
      id="show-delete-column"
      checked={showDeleteColumn}
      onCheckedChange={setShowDeleteColumn}
    />
    <Label htmlFor="show-delete-column" className="text-sm text-red-600">
      Visa raderingskolumn
    </Label>
  </div>
</div>
```

### 3c. Kolumnheader i tabellen

Lägg till precis FÖRE den befintliga "Länk"-kolumnen (sista `<TableHead>`):

```jsx
{showDeleteColumn && (
  <TableHead className="w-12 text-center text-red-500">Radera</TableHead>
)}
```

### 3d. Radcell med papperskorg

I varje `<TableRow>` för konton, lägg till precis FÖRE länk-cellen:

```jsx
{showDeleteColumn && (
  <TableCell className="text-center">
    {!account._reachOnly && (
      <button
        onClick={() => setDeleteConfirm({
          accountName: account.account_name,
          platform: account.platform,
          postCount: account.post_count,
        })}
        className="inline-flex items-center justify-center text-red-400 hover:text-red-600 transition-colors"
        title={`Radera ${account.account_name} från vald period`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    )}
  </TableCell>
)}
```

**OBS:** `_reachOnly`-konton ska INTE ha papperskorg — de har inga poster att radera (och reach ska inte röras). Importera `Trash2` från lucide-react (redan används i ImportManager).

### 3e. Totalrad (Totalt-raden)

Lägg till en tom cell i totalraden på samma position:

```jsx
{showDeleteColumn && <TableCell />}
```

### 3f. Bekräftelsedialog

Lägg till precis före `<Table>` (inuti Card-komponenten). Använd INTE den befintliga shadcn AlertDialog — använd en enkel inline-variant som redan finns i ImportManager (Alert + knappar):

```jsx
{deleteConfirm && (
  <Alert variant="destructive" className="mb-4">
    <AlertCircle className="h-4 w-4" />
    <AlertTitle>Bekräfta radering</AlertTitle>
    <AlertDescription>
      <p className="mb-2">
        Radera alla <strong>{deleteConfirm.postCount}</strong> poster för{' '}
        <strong>{deleteConfirm.accountName}</strong> ({deleteConfirm.platform === 'facebook' ? 'Facebook' : 'Instagram'})
        {' '}i vald period? Detta kan inte ångras.
      </p>
      <div className="flex space-x-2 mt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDeleteConfirm(null)}
          disabled={deleteLoading}
        >
          Avbryt
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDeleteAccount}
          disabled={deleteLoading}
        >
          {deleteLoading ? 'Raderar...' : 'Ja, radera'}
        </Button>
      </div>
    </AlertDescription>
  </Alert>
)}
```

### 3g. Delete-handler

```js
const handleDeleteAccount = async () => {
  if (!deleteConfirm) return;
  setDeleteLoading(true);
  try {
    await api.deleteAccountPosts(
      deleteConfirm.accountName,
      deleteConfirm.platform,
      periodParams
    );
    setDeleteConfirm(null);
    // Trigger data refresh — redan befintlig useEffect reagerar på periodParams,
    // men vi behöver tvinga en refetch. Enklaste lösningen: lägg till en refreshCounter.
    setRefreshCounter(c => c + 1);
  } catch (err) {
    console.error('Radering misslyckades:', err);
    alert(`Radering misslyckades: ${err.message}`);
  } finally {
    setDeleteLoading(false);
  }
};
```

### 3h. Refresh-mekanism

Lägg till state:

```js
const [refreshCounter, setRefreshCounter] = useState(0);
```

Lägg till `refreshCounter` i dependency-arrayen för det befintliga `useEffect` som hämtar kontodata (det som börjar med `const fetchData = async () => {`):

```js
}, [selectedFields, platform, periodParams, showReachOnlyAccounts, refreshCounter]);
```

### 3i. Importera saknade komponenter

Lägg till i befintliga importrader:

```js
import { Trash2 } from 'lucide-react'; // redan finns i filen? Kontrollera. Om inte, lägg till.
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle } from 'lucide-react';
```

Kontrollera vilka av dessa som redan importeras i filen innan du lägger till dubletter.

---

## 4. Vad som INTE ska ändras

- `account_reach`-tabellen — ska aldrig röras av denna funktion
- `ga_listens`-tabellen — ska aldrig röras
- `imports`-tabellen — lämnas orörd (poster raderas men import-records finns kvar, vilket är acceptabelt)
- GA-listens-läget (`gaListensMode`) — raderingskolumnen ska INTE visas i GA-läget

### GA-läget guard

I GA-listens early-return-blocket (som redan finns) behöver inget ändras — raderingskolumnen styrs av `showDeleteColumn` som aldrig aktiveras i GA-vyn. Men som extra säkerhet: dölj toggle-knappen om `gaListensMode` är true:

```jsx
{!gaListensMode && (
  <div className="flex items-center gap-2">
    <Switch ... />
    <Label ...>Visa raderingskolumn</Label>
  </div>
)}
```

---

## 5. Tester att utföra manuellt

1. **Toggle off by default** — öppna kontovyn, verifiera att ingen raderingskolumn syns
2. **Toggle on** — slå på switchen, verifiera att papperskorgar dyker upp
3. **Reach-only-konton** — ska INTE ha papperskorg
4. **Klicka papperskorg** — bekräftelsedialog visas med rätt kontonamn, plattform och antal poster
5. **Avbryt** — dialogen stängs, inget raderas
6. **Bekräfta** — poster raderas, tabellen uppdateras, kontot försvinner (eller visar 0)
7. **Period-scoping** — välj en annan månad, radera, verifiera att bara poster i den månaden försvann
8. **Tom radering** — om kontot inte har poster i perioden, ska 404 returneras
9. **Collab-redetection** — efter radering ska collab-flaggor uppdateras

---

## Modell

**Sonnet räcker.** Uppgiften följer befintliga mönster exakt — liknande DELETE-endpoint finns i `imports.js`, liknande UI-mönster finns i `ImportManager.jsx`. Ingen ny arkitektur behövs.
