
# Implementation Directive — Deterministic Dedup + About Page

**Version bump:** patch (bug fix + documentation feature)
**Model:** Opus
**Commit message:** `fix(import): deterministic dedup by highest interactions + feat: add About page with metric reference`

---

## Repo Access

You have full access to the Git repository. **Read the actual source files before making changes.** The analysis below is based on real CSV data and a verified DB dump — the numbers are exact, not estimates.

Key files to read first:
- `server/services/csvProcessor.js` — `parseCSV()` and `mapRow()` (this is where the dedup fix goes)
- `server/routes/imports.js` — the upsert logic (context for understanding current behavior)
- `src/utils/columnConfig.js` — all column mappings, metric definitions, `getValue()`
- `shared/columnConfig.js` — server-side copy of above
- `server/routes/trends.js` — `METRIC_SQL_MAP` (shows which metrics are SUMmed vs AVGed)
- `src/renderer/components/MainView/MainView.jsx` — navigation structure (for adding About page route)
- `CLAUDE.md` — project conventions

---

## Background: The Problem

Meta Business Suite CSV exports can contain duplicate rows with the same `Publicerings-id`. These duplicates are **not homogeneous** — some have identical values on both rows, others have real data on one row and NaN/0 on the other.

The current import pipeline has no pre-insert dedup. The DB upsert (`ON CONFLICT(post_id, platform) DO UPDATE SET`) blindly overwrites with the last row encountered. This means:

- **Import order changes the result.** The same CSV can produce different DB totals depending on which duplicate row happens to be last.
- **Data loss.** A duplicate row with interactions=0 can overwrite a row with interactions=869.
- **Non-reproducibility.** Users see different totals after reimporting the same files.

Verified example from March 2026 Riks export: 11 duplicate post_ids, 3 of which have NaN on the last row → 7,789 interactions silently lost via last-write-wins.

Additionally, some CSV exports contain both Swedish and English columns (e.g., "Reaktioner" + "Reactions"). The app's `mapRow()` correctly falls back to English columns when Swedish are empty. This is correct behavior and should be preserved — but it should be logged so the user understands why the app total can exceed the visible Swedish column total.

---

## Part 1: Deterministic Dedup in parseCSV()

### Strategy: "Keep highest interactions" per post_id

After the main parsing loop in `parseCSV()` (which builds the `posts` array), add a dedup pass that:

1. Groups posts by `post_id`
2. For each group with more than one entry, keeps only the post with the highest `interactions` value
3. Logs the number of duplicates removed and total interactions delta

This is **deterministic** (same CSV always produces same result), **order-independent** (doesn't matter which row came first), and **conservative** (never loses data that was present in at least one row).

### Where to insert

In `server/services/csvProcessor.js`, in the `parseCSV()` function, **after** the `for (const rawRow of result.data)` loop and **before** the month derivation / return statement.

### Implementation

```js
// --- Deduplicate by post_id: keep the row with highest interactions ---
const postMap = new Map();
let dupCount = 0;
for (const post of posts) {
  if (!post.post_id) continue;
  const existing = postMap.get(post.post_id);
  if (existing) {
    dupCount++;
    if (post.interactions > existing.interactions) {
      postMap.set(post.post_id, post);
    }
    // else: keep existing (it has higher or equal interactions)
  } else {
    postMap.set(post.post_id, post);
  }
}
const dedupedPosts = [...postMap.values()];
// Also include posts without post_id (shouldn't exist, but defensive)
const noIdPosts = posts.filter(p => !p.post_id);
const finalPosts = [...dedupedPosts, ...noIdPosts];
```

Then replace references to `posts` below this point with `finalPosts`:
- The `dates` array is already populated from the loop, so no change needed there.
- The `uniqueAccounts` Set should be built from `finalPosts`.
- The return value should use `finalPosts` instead of `posts`.
- Add `dupCount` to the returned `stats` object as `duplicatesRemoved`.

### Update stats in return value

```js
stats: {
  totalRows: result.data.length,
  parsedPosts: finalPosts.length,
  duplicatesRemoved: dupCount,    // ← new
  accountCount: uniqueAccounts.size || 1,
},
```

### Update import response

In `server/routes/imports.js`, include `duplicatesRemoved` in the response JSON so the user can see it:

```js
stats: {
  totalRowsInFile: parsed.stats.totalRows,
  parsedPosts: parsed.stats.parsedPosts,
  duplicatesRemoved: parsed.stats.duplicatesRemoved,   // ← new
  postsInserted: result.inserted,
  postsUpdated: result.updated,
  collabDetection: collabResult,
},
```

### Log EN-column fallback

Also in `parseCSV()`, after the parsing loop but before dedup, count how many posts got their values from English fallback columns. The signal is: the Swedish column was null/empty but the mapped value is non-zero, which happens when `mapRow()` fills from the English column.

This doesn't require code changes to `mapRow()` — just a counter in `parseCSV()` that's included in stats:

```js
stats: {
  totalRows: result.data.length,
  parsedPosts: finalPosts.length,
  duplicatesRemoved: dupCount,
  enFallbackPosts: enFallbackCount,   // ← new (count posts where EN columns provided data)
  accountCount: uniqueAccounts.size || 1,
},
```

To detect EN fallback: before the main loop, check if the CSV has both Swedish and English columns mapped to the same internal name. If so, after mapping each row, compare: if the mapped `likes`/`comments`/`shares` are non-zero but the original Swedish column value was null/empty, increment the counter. This is a heuristic — exact implementation left to your judgment based on reading the actual `mapRow()` code.

---

## Part 2: About Page ("Om")

Create a new page accessible from the app's navigation/sidebar. Swedish UI. The page has two sections:

### Section 1: Mätpunkter (Metrics Reference)

A reference table/list explaining every metric the app displays. Group by platform where relevant.

#### Facebook-mätpunkter

| Mätpunkt | Intern nyckel | Beskrivning | Källa | Summerbar? |
|---|---|---|---|---|
| Visningar | `views` | Antal gånger inlägget visats (inklusive upprepade visningar av samma person) | CSV: "Visningar" | Ja |
| Räckvidd | `reach` | Uppskattat antal unika personer som sett inlägget | CSV: "Räckvidd" | **Nej** — appen visar genomsnitt vid aggregering |
| Reaktioner | `likes` | Antal reaktioner (gilla, hjärta, haha, arg, etc.) | CSV: "Reaktioner" | Ja |
| Kommentarer | `comments` | Antal kommentarer på inlägget | CSV: "Kommentarer" | Ja |
| Delningar | `shares` | Antal gånger inlägget delats | CSV: "Delningar" | Ja |
| Interaktioner | `interactions` | Reaktioner + kommentarer + delningar. Beräknas alltid från delvärdena, inte från Metas sammansatta kolumn. | Beräknad | Ja |
| Engagemang | `engagement` | Interaktioner + totalt antal klick. Bredare mått som inkluderar alla typer av användaraktivitet. | Beräknad | Ja |
| Totalt antal klick | `total_clicks` | Alla klick på inlägget (länkklick + övriga klick) | CSV: "Totalt antal klick" | Ja |
| Länkklick | `link_clicks` | Klick på länkar i inlägget | CSV: "Länkklick" | Ja |
| Övriga klick | `other_clicks` | Klick som inte är länkklick (t.ex. klick för att expandera bild) | CSV: "Övriga klick" | Ja |
| Kontoräckvidd | `account_reach` | Månatlig räckvidd per konto. Separat datakälla (Graph API), inte från post-CSV. | API-export | **Nej** — kan inte summeras meningsfullt |

#### Instagram-mätpunkter

| Mätpunkt | Intern nyckel | Beskrivning | Källa | Summerbar? |
|---|---|---|---|---|
| Visningar | `views` | Antal gånger inlägget visats | CSV: "Visningar" | Ja |
| Räckvidd | `reach` | Uppskattat antal unika konton som sett inlägget | CSV: "Räckvidd" | **Nej** |
| Gilla-markeringar | `likes` | Antal gilla-markeringar | CSV: "Gilla-markeringar" | Ja |
| Kommentarer | `comments` | Antal kommentarer | CSV: "Kommentarer" | Ja |
| Delningar | `shares` | Antal gånger inlägget delats | CSV: "Delningar" | Ja |
| Sparade | `saves` | Antal gånger inlägget sparats | CSV: "Sparade objekt" | Ja |
| Följer | `follows` | Antal nya följare från inlägget | CSV: "Följer" | Ja |
| Interaktioner | `interactions` | Gilla + kommentarer + delningar | Beräknad | Ja |
| Engagemang | `engagement` | Gilla + kommentarer + delningar + sparade + följer. Bredare mått anpassat för Instagram. | Beräknad | Ja |

#### Google Analytics (GA-lyssningar)

| Mätpunkt | Intern nyckel | Beskrivning | Källa | Summerbar? |
|---|---|---|---|---|
| Lyssningar | `listens` | Antal lyssningar per program och månad | GA CSV-export | Ja |

**Notering:** GA-lyssningsdata har ingen datumgranularitet — det är alltid hela månader. Anpassade datumintervall har ingen effekt på GA-data.

### Section 2: Hur appen hanterar data

Skriv detta som löpande text med underrubriker, inte som tabell. Tonen ska vara saklig och hjälpsam — som en teknisk FAQ. Texterna nedan är **innehållsriktlinjer** — formulera dem naturligt på svenska, inte som en ordagrann specifikation.

#### Deduplicering

Meta Business Suites CSV-exporter kan innehålla dubletter — samma inläggs-id förekommer på flera rader, ibland med olika värden. Appen hanterar detta genom att behålla den rad som har högst interaktionsvärde per inläggs-id. Detta ger ett deterministiskt resultat: samma CSV-fil ger alltid samma total oavsett radordning.

Antalet borttagna dubbletter visas i importsammanfattningen.

#### Kolumn-fallback (svenska/engelska)

Vissa Meta-exporter innehåller kolumner på både svenska och engelska. Om den svenska kolumnen saknar data men den engelska har ett värde, används det engelska värdet. Detta innebär att appens total ibland kan vara högre än om man bara summerar de svenska kolumnerna manuellt i CSV-filen.

#### Upsert vid reimport

När samma data importeras igen uppdateras befintliga poster baserat på inläggs-id. Poster som fanns i en tidigare import men saknas i den nya filen behålls — databasen reflekterar alltså den mest kompletta bilden av all importerad data, inte nödvändigtvis en enskild CSV-export.

#### Summerbara och icke-summerbara mätpunkter

Mätpunkter som visningar, interaktioner och klick kan summeras meningsfullt över flera konton. Räckvidd (reach) kan **inte** summeras — en person som följer tre konton räknas i alla tre kontons räckvidd men är fortfarande en unik person. Appen visar genomsnitt istället för summa för räckviddsmått vid aggregering.

Kontoräckvidd (account_reach) från Graph API är en helt separat datakälla med egen import och kan inte jämföras direkt med postbaserad räckvidd.

#### Samarbetsinlägg (collabs)

Inlägg som publicerats som samarbete mellan flera konton detekteras automatiskt och flaggas. Detta förhindrar dubbelräkning vid aggregering — ett samarbetsinlägg räknas bara en gång, inte en gång per deltagande konto.

---

## Part 2 Implementation Details

### Component

Create `src/renderer/components/AboutView/AboutView.jsx`.

Use the same styling patterns as other views in the app (read `AccountView.jsx` or `TrendAnalysisView.jsx` for reference). Use existing UI components (Card, Table, etc.) from `src/renderer/components/ui/`.

The page should be a scrollable, readable reference document — not a dashboard. Think documentation page, not settings page.

### Navigation

Add a navigation entry to reach the About page. Read `MainView.jsx` to understand how navigation currently works (sidebar, tabs, or whatever pattern is used). Add an entry at the bottom of the navigation, using an `Info` or `HelpCircle` icon from lucide-react. Label: "Om appen".

### Route/State

Follow whatever routing pattern the app uses (likely conditional rendering based on a state variable in MainView). Add `'about'` as a new view option.

---

## Part 3: Update README and Version

1. **README.md** — Add a brief mention of the About page under the features section. Something like: "Built-in metric reference and data handling documentation (Om appen)".

2. **Version** — Bump patch version in both `package.json` and `src/utils/version.js` (check both files — they need to stay in sync).

3. **CHANGELOG** or equivalent — If the project has one, add entries for both the dedup fix and the About page.

---

## Verification Checklist

After implementation, verify:

- [ ] Import a CSV with known duplicates → import response shows `duplicatesRemoved > 0`
- [ ] Import the same CSV twice → same total both times (deterministic)
- [ ] Import a CSV with EN-only rows (like P4 Kristianstad) → those posts have correct interactions, not 0
- [ ] "Om appen" is accessible from the navigation
- [ ] All metric tables render correctly with proper Swedish text
- [ ] The data handling explanations are present and readable
- [ ] Version is bumped consistently in package.json and version.js
- [ ] README mentions the new About page
- [ ] Existing tests (if any) still pass
- [ ] The app builds without errors

---

## Files Changed (expected)

| File | Action |
|---|---|
| `server/services/csvProcessor.js` | **EDIT** — add dedup pass + EN fallback counter in `parseCSV()` |
| `server/routes/imports.js` | **EDIT** — include new stats in response |
| `src/renderer/components/AboutView/AboutView.jsx` | **NEW** — About page component |
| `src/renderer/components/MainView/MainView.jsx` | **EDIT** — add About view routing + nav entry |
| `package.json` | **EDIT** — version bump |
| `src/utils/version.js` | **EDIT** — version bump |
| `README.md` | **EDIT** — mention About page |
