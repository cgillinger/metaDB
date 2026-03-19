# Bugfix Fas 2 – Performance, Engagement-info & Uppladdnings-UX

## P1: Performance – getValue()-fallbacken är dyr

### Problem
`getValue()` i `columnConfig.js` (rad ~145–155) har en fallback som itererar ALLA nycklar i dataobjektet med `normalizeText()` på varje nyckel. Det innebär att varje cell-render som inte hittar fältet direkt kör en O(n)-loop med strängoperationer.

### Fix
Lägg till en early-return i `getValue()` FÖRE fallback-loopen. De vanligaste fälten (`likes`, `comments`, `shares`, `views`, `reach`, etc.) träffar alltid direct access. Fallback-loopen behövs bara om fältnamnet inte matchar exakt – vilket i praktiken aldrig händer med vår normaliserade datamodell.

Ändra `getValue()` till:

```javascript
export function getValue(dataObject, targetField) {
  if (!dataObject || !targetField) return null;

  // Direct access (covers 99% of cases)
  if (dataObject[targetField] !== undefined) {
    return dataObject[targetField];
  }

  // Calculated fields
  if (targetField === 'interactions') {
    return (safeParseValue(dataObject.likes) || 0)
         + (safeParseValue(dataObject.comments) || 0)
         + (safeParseValue(dataObject.shares) || 0);
  }

  if (targetField === 'engagement') {
    const likes = safeParseValue(dataObject.likes) || 0;
    const comments = safeParseValue(dataObject.comments) || 0;
    const shares = safeParseValue(dataObject.shares) || 0;
    if (dataObject._platform === 'facebook') {
      return likes + comments + shares + (safeParseValue(dataObject.total_clicks) || 0);
    }
    return likes + comments + shares
         + (safeParseValue(dataObject.saves) || 0)
         + (safeParseValue(dataObject.follows) || 0);
  }

  // SKIP the normalizeText fallback loop entirely.
  // All our data uses exact field names after CSV mapping.
  // If we get here, the field genuinely doesn't exist.
  return null;
}
```

**Ta bort den normaliserade fallback-loopen.** Den var en säkerhetsmekanism från den gamla koden som inte behövs efter att CSV-mappningen normaliserats.

### Också: konsolidera totalSummary i AccountView

I `AccountView.jsx`, `totalSummary`-memot itererar `data` flera gånger. Konsolidera till EN loop:

```javascript
const totalSummary = useMemo(() => {
  if (!Array.isArray(summaryData) || summaryData.length === 0 || !Array.isArray(data)) return {};

  const totals = { account_name: 'Totalt' };
  let tLikes = 0, tComments = 0, tShares = 0, tSaves = 0, tFollows = 0;
  let tClicks = 0, tOtherClicks = 0, tLinkClicks = 0, tViews = 0, tEngagement = 0;

  for (const post of data) {
    tLikes += (post.likes || 0);
    tComments += (post.comments || 0);
    tShares += (post.shares || 0);
    tSaves += (post.saves || 0);
    tFollows += (post.follows || 0);
    tClicks += (post.total_clicks || 0);
    tOtherClicks += (post.other_clicks || 0);
    tLinkClicks += (post.link_clicks || 0);
    tViews += (post.views || 0);
    // Beräkna engagement inline istället för att anropa getValue()
    if (post._platform === 'facebook') {
      tEngagement += (post.likes || 0) + (post.comments || 0) + (post.shares || 0) + (post.total_clicks || 0);
    } else {
      tEngagement += (post.likes || 0) + (post.comments || 0) + (post.shares || 0) + (post.saves || 0) + (post.follows || 0);
    }
  }

  // Tilldela bara de fält som är valda
  if (selectedFields.includes('likes')) totals.likes = tLikes;
  if (selectedFields.includes('comments')) totals.comments = tComments;
  if (selectedFields.includes('shares')) totals.shares = tShares;
  if (selectedFields.includes('saves')) totals.saves = tSaves;
  if (selectedFields.includes('follows')) totals.follows = tFollows;
  if (selectedFields.includes('total_clicks')) totals.total_clicks = tClicks;
  if (selectedFields.includes('other_clicks')) totals.other_clicks = tOtherClicks;
  if (selectedFields.includes('link_clicks')) totals.link_clicks = tLinkClicks;
  if (selectedFields.includes('views')) totals.views = tViews;
  if (selectedFields.includes('interactions')) totals.interactions = tLikes + tComments + tShares;
  if (selectedFields.includes('engagement')) totals.engagement = tEngagement;
  if (selectedFields.includes('post_count')) totals.post_count = data.length;

  return totals;
}, [summaryData, selectedFields, data]);
```

Notera: vi läser `post.likes` direkt istället för `getValue(post, 'likes')` – det undviker funktionsanropsoverhead i en tight loop.

---

## P2: Engagement-tooltip – byt från hover till klickbar popover

### Problem
`InfoTooltip`-komponenten i AccountView och PostView använder `onMouseEnter/onMouseLeave` på en 14px-ikon. Den är:
- Omöjlig att använda på mobil/touch
- Svår att träffa på desktop
- Absolut-positionerad utan viewport-kontroll

### Fix
Byt till en enkel klickbar tooltip:

```jsx
const InfoTooltip = ({ text }) => {
  const [visible, setVisible] = React.useState(false);
  const ref = React.useRef(null);

  // Stäng vid klick utanför
  React.useEffect(() => {
    if (!visible) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setVisible(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [visible]);

  if (!text) return null;

  return (
    <span ref={ref} className="relative inline-flex items-center ml-1">
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        className="text-gray-400 hover:text-gray-600 focus:outline-none"
        aria-label="Visa information om engagemang"
      >
        <Info className="h-4 w-4" />
      </button>
      {visible && (
        <span className="absolute left-6 bottom-0 z-50 w-72 rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
};
```

Extrahera till `src/renderer/components/ui/InfoTooltip.jsx` och importera i AccountView och PostView (de har varsin kopia just nu – DRY).

---

## P3: Tydligare plattformsindikation vid filuppladdning

### Problem
Plattformsnamnet visas som liten grå text (`· Facebook`) i fillistan. Svårt att se.

### Fix
Importera `PlatformBadge` i `FileUploader.jsx` och visa den som badge istället för text:

Hitta raden i FileUploader som renderar plattform:
```jsx
{entry.platform
  ? ` · ${PLATFORM_LABELS[entry.platform] || entry.platform}`
  : ''}
```

Ersätt med:
```jsx
{entry.platform && (
  <PlatformBadge platform={entry.platform} />
)}
```

Flytta badgen till BREDVID filnamnet (inte i den grå texten under). Ändra filraden till:

```jsx
<div className="min-w-0">
  <p className="font-medium truncate flex items-center gap-1.5">
    {entry.file.name}
    {entry.platform && <PlatformBadge platform={entry.platform} />}
  </p>
  <p className="text-xs text-muted-foreground">
    {entry.analysis ? `${entry.analysis.rows} rader · ${entry.analysis.fileSizeKB} KB` : ''}
  </p>
  ...
</div>
```

---

## Ordning

1. **P1 först** – getValue()-fixen och totalSummary-konsolideringen. Testa att laggen minskar.
2. **P3** – snabb fix, byt ut plattformstext mot PlatformBadge i FileUploader
3. **P2 sist** – InfoTooltip-refaktoreringen

## Regler
- Ändra INTE webDataProcessor, storageService eller datamodellen
- Testa med riktiga CSV-filer efter varje steg
- Bryt inte exportfunktionalitet
