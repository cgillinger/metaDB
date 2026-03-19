# Bugfix Fas 3 – CSV-dubbelformat & Samarbetsinlägg

## Bakgrund

Metas Instagram CSV-export har två problem som appen måste hantera:

### Problem 1: Dubbelt kolumnformat → dubblerade konton

CSV-filen har 21 kolumner i headern. Kontoinformation finns i **antingen**:
- **Svenska kolumner** (pos 1–3): `Konto-id`, `Kontots användarnamn`, `Kontonamn`
- **Engelska kolumner** (pos 18–20): `Account ID`, `Account username`, `Account name`

Ca 14% av raderna har **tomma svenska kolumner** men fyllda engelska. Appen läser bara de svenska → dessa rader får `account_id = ""` och `account_name = "Okänt konto"`.

Resultat: samma konto (t.ex. Sveriges Radio P2) visas två gånger – en gång med rätt namn, en gång som "Okänt konto".

### Problem 2: Samarbetsinlägg (collab posts) blandas med egna

När ett externt konto gör en collab-post med ett SR-konto, inkluderar Meta inlägget i SR:s export – men med det **externa kontots** namn och ID. Exempel:
- "Norrbottensteatern" dyker upp bland "Det politiska spelet"-data
- "Sverker Rundqvist" dyker upp bland Berwaldhallen-data
- "Club 2000" dyker upp bland SR Finska-data
- "Musik i Dalarna" dyker upp bland Berwaldhallen/P2-data

Dessa är INTE SR-konton men syns i appen som egna konton.

---

## Fix 1: Engelska fallback-kolumner i webDataProcessor.js

### Var
`src/utils/webDataProcessor.js`, i funktionen som processar varje rad (inuti `processCSVData`, efter `mapColumnNames()`).

### Vad
Efter att raden mappats med svenska kolumnnamn, kontrollera om nyckelidentifierarna saknas. Om de gör det, läs från de engelska kolumnerna i råraden.

### Exakt implementation

I `processCSVData()`, hitta raden:
```javascript
const mappedRow = mapColumnNames(row, columnMappings);
```

Lägg till DIREKT EFTER:
```javascript
// Fallback: Meta exports sometimes have empty Swedish columns
// but filled English columns (positions 18-20 in header).
// Raw row still has the original column names as keys.
if (!mappedRow.account_id || mappedRow.account_id === '') {
  const fallbackId = row['Account ID'] || row['account_id'];
  if (fallbackId) mappedRow.account_id = fallbackId;
}
if (!mappedRow.account_name || mappedRow.account_name === '') {
  const fallbackName = row['Account name'] || row['account_name'];
  if (fallbackName) mappedRow.account_name = fallbackName;
}
if (!mappedRow.account_username || mappedRow.account_username === '') {
  const fallbackUsername = row['Account username'] || row['account_username'];
  if (fallbackUsername) mappedRow.account_username = fallbackUsername;
}
```

### Kontrollera
- [ ] Ladda Insta_riks_Feb-filen. Sveriges Radio P2 ska visas EN gång med 15+ inlägg, inte 2 gånger.
- [ ] Inga "Okänt konto"-rader ska finnas (om det inte faktiskt saknas kontonamn).

---

## Fix 2: Detektera och markera samarbetsinlägg

### Steg 2a: Detektera collab i webDataProcessor.js

Samarbetsinlägg identifieras genom att inläggets `account_id` INTE matchar det konto som förväntas i exporten. Vi kan inte veta exakt vilka som är "egna" konton, men vi kan använda en heuristik:

**I `processCSVData()`**, efter att alla rader processats (dvs efter `filteredData.forEach`-loopen), identifiera majoritetskontonerna och markera avvikare:

```javascript
// Detect collab posts: accounts with very few posts compared to majority
// A collab post appears as a "foreign" account_id among the main accounts
const accountPostCounts = {};
for (const post of perPost) {
  const aid = post.account_id;
  if (!aid) continue;
  accountPostCounts[aid] = (accountPostCounts[aid] || 0) + 1;
}

// An account is likely a collab if:
// 1. It has very few posts (≤3) AND
// 2. It's not the only account in the file (there are "main" accounts with many more posts)
const totalPosts = perPost.length;
const maxPostCount = Math.max(...Object.values(accountPostCounts), 0);
const collabThreshold = Math.max(3, Math.ceil(maxPostCount * 0.05)); // max 5% of largest account

const collabAccountIds = new Set();
for (const [aid, count] of Object.entries(accountPostCounts)) {
  if (count <= collabThreshold && Object.keys(accountPostCounts).length > 1) {
    collabAccountIds.add(aid);
  }
}

// Tag collab posts
for (const post of perPost) {
  if (collabAccountIds.has(post.account_id)) {
    post._isCollab = true;
  }
}

// Tag collab accounts
for (const key in perKonto) {
  if (collabAccountIds.has(perKonto[key].account_id)) {
    perKonto[key]._isCollab = true;
  }
}
```

**VIKTIGT:** Heuristiken ovan har en svaghet – den kan markera riktiga SR-konton som bara har få inlägg i perioden. Därför behöver tröskelvärdet vara lågt (max 3 inlägg ELLER max 5% av största kontot). Testa med riktiga data och justera vid behov.

### Steg 2b: UI-markering i alla vyer

#### Ny komponent: CollabBadge

Skapa `src/renderer/components/ui/CollabBadge.jsx`:

```jsx
import React from 'react';
import { Users } from 'lucide-react';

const CollabBadge = ({ compact = false }) => {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-300">
        <Users className="h-3 w-3" />
        Collab
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-300" title="Samarbetsinlägg – det här kontot är inte ditt, men inlägget syns i din export pga en collab-publicering">
      <Users className="h-3 w-3" />
      Samarbete
    </span>
  );
};

export default CollabBadge;
```

#### AccountView.jsx

Visa CollabBadge bredvid kontonamnet, EFTER PlatformBadge:

```jsx
import CollabBadge from '../ui/CollabBadge';

// I kontonamn-cellen:
<div className="flex items-center space-x-2">
  <ProfileIcon accountName={accountName} />
  <span>{accountName || 'Unknown'}</span>
  <PlatformBadge platform={account._platform} />
  {account._isCollab && <CollabBadge />}
</div>
```

Collab-rader ska dessutom ha en **visuell nedtoning**. Lägg till en klass på hela raden:

```jsx
<TableRow
  key={...}
  className={account._isCollab ? 'bg-amber-50/50 opacity-75' : ''}
>
```

#### PostView.jsx

Visa CollabBadge i plattforms-kolumnen (eller bredvid den):

```jsx
<TableCell className="text-center">
  <div className="flex items-center justify-center gap-1">
    <PlatformBadge platform={platform} />
    {post._isCollab && <CollabBadge compact />}
  </div>
</TableCell>
```

#### PostTypeView.jsx

Ingen ändring behövs – collab-inlägg aggregeras per inläggstyp som vanligt. Eventuellt: visa en fotnot om det finns collab-inlägg i datan.

#### TrendAnalysisView.jsx

Visa CollabBadge i kontolistan (checkboxarna):

```jsx
<span className="text-sm font-medium flex items-center gap-1.5">
  {account.account_name}
  <PlatformBadge platform={account._platform} />
  {account._isCollab && <CollabBadge compact />}
</span>
```

Och i legenden under grafen:

```jsx
<span className="text-sm font-medium truncate flex items-center gap-1" title={line.account_name}>
  {line.account_name.length > 20 ? line.account_name.substring(0, 17) + '...' : line.account_name}
  <PlatformBadge platform={line._platform} />
  {line._isCollab && <CollabBadge compact />}
</span>
```

#### Konto-dropdowns (PostView, PostTypeView)

Visa CollabBadge i dropdown-options:

```jsx
<SelectItem key={name} value={name}>
  <span className="flex items-center gap-2">
    {name}
    <PlatformBadge platform={platform} />
    {isCollab && <CollabBadge compact />}
  </span>
</SelectItem>
```

Detta kräver att `uniqueAccounts`-memot också inkluderar `_isCollab`. Ändra:
```javascript
const uniqueAccounts = useMemo(() => {
  if (!data || !Array.isArray(data)) return [];
  const map = {};
  for (const post of data) {
    const name = getValue(post, 'account_name');
    if (name) {
      map[name] = {
        platform: post._platform || null,
        isCollab: post._isCollab || false,
      };
    }
  }
  return Object.entries(map)
    .map(([name, info]) => ({ name, platform: info.platform, isCollab: info.isCollab }))
    .sort((a, b) => a.name.localeCompare(b.name));
}, [data]);
```

### Kontrollera
- [ ] Ladda Insta_riks_Feb-filen. Norrbottensteatern, Sverker Rundqvist, Club 2000, Musik i Dalarna ska ha CollabBadge.
- [ ] Collab-konton ska vara visuellt nedtonade i AccountView.
- [ ] CollabBadge syns i alla kontodropdowns.
- [ ] CollabBadge syns i TrendAnalysisView (kontolista + legend).
- [ ] Riktiga SR-konton (P3 Klubben, Vaken med P3 & P4, etc.) ska INTE markeras som collab trots att de kan ha relativt få inlägg – justera tröskelvärdet om det behövs.

---

## Ordning

1. **Fix 1 först** – engelska fallback-kolumner. Testa att P2-dubbleringen försvinner.
2. **Fix 2a** – collab-detektering i webDataProcessor. Testa i konsolen att `_isCollab` sätts korrekt.
3. **Fix 2b** – UI-markeringar. Testa i alla vyer.

## Regler
- Fix 1 ändrar BARA webDataProcessor.js (efter `mapColumnNames`-anropet)
- Fix 2a ändrar BARA webDataProcessor.js (efter processerings-loopen)
- Fix 2b ändrar BARA UI-komponenter
- Bryt INTE befintlig export, filtrering eller plattformsdetektering
- Testa med riktiga CSV-filer efter varje steg
- Bekräfta med mig innan nästa steg
