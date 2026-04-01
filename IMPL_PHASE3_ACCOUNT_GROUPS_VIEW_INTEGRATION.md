# Implementation Directive — Account Groups: Phase 3 (View Integration + Aggregation)

**Version bump:** None (still 2.3.0 — finalize feature)
**Model:** Opus recommended (complex cross-component data flow)
**Commit message:** `feat(account-groups): integrate groups into AccountView and TrendAnalysisView with aggregation`

**Prerequisite:** Phase 1 (backend) and Phase 2 (management UI) must be complete and verified.

---

## Repo Access

You have full access to the Git repository. **Read the actual source files thoroughly before making any changes.** This phase touches complex existing data flows — the pseudocode in this directive illustrates the *intent* and *aggregation logic*, but the actual variable names, data structures, and control flow in the repo are the source of truth. Do not copy-paste the pseudocode verbatim; adapt it to match the real code.

**Critical files to read in full before starting:**
- `src/renderer/components/TrendAnalysisView/TrendAnalysisView.jsx` — understand the full component: how `accountList`/`gaAccountList` are built, how `selectedAccounts` drives data fetching, how chart data is constructed from `trendData`/`gaPivot`, and how the SVG chart renders series
- `src/renderer/components/AccountView/AccountView.jsx` — understand GA summary mode, GA monthly mode, and posts mode rendering; how `gaSummary`, `gaData`, `accountData` are used
- `src/renderer/components/MainView/MainView.jsx` — verify Phase 2 state (`accountGroups`, `refreshAccountGroups`) is in place; understand prop flow to child views
- `src/renderer/components/AccountGroups/GroupCreateDialog.jsx` — verify Phase 2 dialog exists and understand its API
- `src/utils/apiClient.js` — verify group API methods from Phase 1
- `server/routes/trends.js` — understand what the trends API returns (series structure, months array) so frontend aggregation matches

**Read these files first. Then plan the changes. Then implement.**

---

## Overview

This phase makes account groups functional in the data views:
1. Groups appear as selectable items in account lists (TrendAnalysisView, AccountView GA mode)
2. Selecting a group produces aggregated data (SUM where valid, excluded where not)
3. Groups are visually distinct from individual accounts
4. A contextual "Skapa grupp" button is added to account lists

---

## Critical Aggregation Rules

These rules are non-negotiable and must be enforced in all views:

### Summable metrics (SUM across group members)
`views`, `likes`, `comments`, `shares`, `saves`, `follows`, `total_clicks`, `link_clicks`, `other_clicks`, `interactions`, `engagement`, `post_count`, `listens` (GA)

### Non-summable metrics (must be EXCLUDED or shown as "–")
`reach`, `average_reach`, `account_reach`, `posts_per_day`

**Exception:** `posts_per_day` CAN be recalculated as `total_post_count / total_days_span` for the group if needed. But it's simpler to show "–" for now.

---

## 1. TrendAnalysisView Integration

File: `src/renderer/components/TrendAnalysisView/TrendAnalysisView.jsx`

### 1.1 Props

Add to component props:

```js
const TrendAnalysisView = ({
  platform,
  periodParams = {},
  gaListensMode = false,
  accountGroups = [],        // NEW
  onGroupsChanged = null,    // NEW — callback to refresh groups after creation
}) => {
```

MainView must pass these props (edit MainView.jsx accordingly).

### 1.2 Inject Groups into Account Lists

The component maintains two separate account lists: `accountList` (posts mode) and `gaAccountList` (GA mode). Groups must be injected into the appropriate list.

**For GA mode** — after `gaAccountList` is built from API data, prepend matching groups:

```js
const gaAccountListWithGroups = useMemo(() => {
  const gaGroups = accountGroups
    .filter(g => g.source === 'ga_listens')
    .map(g => ({
      account_name: g.name,
      platform: 'ga_listens',
      is_collab: false,
      key: `__group__${g.id}`,  // Special prefix to identify groups
      isGroup: true,
      groupId: g.id,
      memberKeys: g.members,
    }));
  return [...gaGroups, ...gaAccountList];
}, [accountGroups, gaAccountList]);
```

**For posts mode** — same pattern with `accountList`:

```js
const accountListWithGroups = useMemo(() => {
  const postGroups = accountGroups
    .filter(g => g.source === 'posts')
    .map(g => ({
      account_name: g.name,
      platform: 'group',
      is_collab: false,
      key: `__group__${g.id}`,
      isGroup: true,
      groupId: g.id,
      memberKeys: g.members,
    }));
  return [...postGroups, ...accountList];
}, [accountGroups, accountList]);
```

Use `gaAccountListWithGroups` and `accountListWithGroups` wherever the account list is rendered for selection. Keep the original `gaAccountList`/`accountList` for data lookups.

### 1.3 Metric Restriction for Groups

When a group is selected, certain metrics must be disabled. Add logic that checks `selectedAccounts` for any group keys:

```js
const hasGroupSelected = selectedAccounts.some(key => key.startsWith('__group__'));
```

In the metric selector, disable and visually grey out non-summable metrics when `hasGroupSelected` is true:
- `reach`, `average_reach`, `account_reach`

Show a tooltip on disabled metrics: "Kan ej aggregeras för kontogrupper".

If the user selects a group while a non-summable metric is active, auto-switch to the first summable metric (e.g., `interactions`).

### 1.4 GA Trend Aggregation (Frontend)

When building chart data for GA mode, the current flow is:
1. `gaRawData` contains flat rows `{account_name, month, listens}`
2. `gaPivot` maps `account_name → { month → listens }`
3. Selected accounts are looked up in `gaPivot` to build series

For a group, build a **synthetic series** by summing member values:

In the `useMemo` that builds GA chart lines (currently filters `gaRawData` by selected accounts), add group handling:

```js
// For each selected account, build a chart series
const lines = selectedAccounts.map((selectedKey, index) => {
  const accountEntry = gaAccountListWithGroups.find(a => a.key === selectedKey);
  if (!accountEntry) return null;

  if (accountEntry.isGroup) {
    // Aggregate: sum listens across all member accounts per month
    const aggregatedByMonth = {};
    for (const memberKey of accountEntry.memberKeys) {
      // memberKey format: "account_name::ga_listens" — extract name
      const memberName = memberKey.split('::')[0];
      const memberData = gaPivot[memberName];
      if (!memberData) continue;
      for (const [month, listens] of Object.entries(memberData)) {
        aggregatedByMonth[month] = (aggregatedByMonth[month] || 0) + listens;
      }
    }

    return {
      key: selectedKey,
      account_name: accountEntry.account_name,
      platform: 'ga_listens',
      is_collab: false,
      isGroup: true,
      color: CHART_COLORS[index % CHART_COLORS.length],
      points: gaMonths.map(m => ({
        month: m,
        value: aggregatedByMonth[m] || 0,
      })),
    };
  }

  // Regular account — existing logic
  const data = gaPivot[accountEntry.account_name] || {};
  return {
    key: selectedKey,
    account_name: accountEntry.account_name,
    platform: 'ga_listens',
    is_collab: false,
    isGroup: false,
    color: CHART_COLORS[index % CHART_COLORS.length],
    points: gaMonths.map(m => ({
      month: m,
      value: data[m] || 0,
    })),
  };
}).filter(Boolean);
```

### 1.5 Posts Trend Aggregation (Frontend)

For posts mode, the backend returns separate series per account via `/api/trends`. Groups need client-side aggregation.

When a group is selected, the frontend must:
1. Extract member account keys from the group
2. Request trend data for ALL member accounts (pass all member keys in `accountKeys`)
3. Sum the returned series into one synthetic series

Modify the trend fetch logic:

```js
// Before fetching, expand group selections into member keys
const expandedKeys = selectedAccounts.flatMap(key => {
  const entry = accountListWithGroups.find(a => a.key === key);
  if (entry?.isGroup) return entry.memberKeys;
  return [key];
});

// Also track which selected items are groups, for post-processing
const groupEntries = selectedAccounts
  .map(key => accountListWithGroups.find(a => a.key === key))
  .filter(a => a?.isGroup);
```

After receiving `trendData` from the API, aggregate series belonging to each group:

```js
// Post-process: merge series belonging to groups
if (groupEntries.length > 0 && trendData?.series) {
  const processedSeries = [];
  const consumedKeys = new Set();

  for (const groupEntry of groupEntries) {
    const memberNames = new Set(
      groupEntry.memberKeys.map(k => k.split('::')[0])
    );
    // Find matching series from API response
    const memberSeries = trendData.series.filter(s => memberNames.has(s.account_name));
    // Sum data arrays element-wise
    const summedData = trendData.months.map((_, i) =>
      memberSeries.reduce((sum, s) => sum + (s.data[i] || 0), 0)
    );
    processedSeries.push({
      account_id: groupEntry.key,
      account_name: groupEntry.account_name,
      platform: 'group',
      is_collab: false,
      isGroup: true,
      data: summedData,
    });
    memberSeries.forEach(s => consumedKeys.add(accountKey(s.account_name, s.platform)));
  }

  // Add non-group series that weren't consumed
  for (const series of trendData.series) {
    const key = accountKey(series.account_name, series.platform);
    if (!consumedKeys.has(key)) {
      processedSeries.push(series);
    }
  }

  trendData = { ...trendData, series: processedSeries };
}
```

### 1.6 Visual Distinction for Group Lines

In the SVG chart rendering, group lines should be visually distinct:
- **Line width:** 3px instead of 2px
- **Line style:** Add a subtle dashed pattern (e.g., `strokeDasharray="8 3"`) OR use a thicker solid line — decide based on what looks cleaner

In the account selection list / legend:
- Show a `Users` icon (from lucide-react) before the group name instead of a platform badge
- Use a slightly different background color for the group row (e.g., `bg-blue-50` or `bg-muted`)

---

## 2. AccountView Integration (GA Mode)

File: `src/renderer/components/AccountView/AccountView.jsx`

### 2.1 Props

Add to component props:

```js
accountGroups = [],
onGroupsChanged = null,
```

MainView must pass these.

### 2.2 GA Summary Mode — Synthetic Group Row

In GA summary mode, the component displays `gaSummary.programmes` as rows in a table. Add synthetic group rows:

```js
const gaSummaryWithGroups = useMemo(() => {
  if (!gaSummary?.programmes) return { programmes: [], grandTotal: 0 };

  const gaGroups = accountGroups.filter(g => g.source === 'ga_listens');
  const syntheticRows = gaGroups.map(group => {
    const memberNames = new Set(group.members.map(k => k.split('::')[0]));
    const memberRows = gaSummary.programmes.filter(p => memberNames.has(p.account_name));
    const totalListens = memberRows.reduce((sum, p) => sum + p.total_listens, 0);
    const maxMonthCount = Math.max(0, ...memberRows.map(p => p.month_count));

    return {
      account_name: group.name,
      total_listens: totalListens,
      month_count: maxMonthCount,
      isGroup: true,
      groupId: group.id,
      memberCount: memberNames.size,
      matchedCount: memberRows.length,
    };
  });

  return {
    programmes: [...syntheticRows, ...gaSummary.programmes],
    grandTotal: gaSummary.grandTotal,
  };
}, [gaSummary, accountGroups]);
```

Use `gaSummaryWithGroups` instead of `gaSummary` for rendering.

### 2.3 GA Monthly Mode — Synthetic Group Row

Same pattern for the monthly pivot view. Sum `listens` across member accounts per month.

### 2.4 Visual Distinction for Group Rows

In the table:
- Group rows appear at the top, above individual accounts
- Group row has a subtle `bg-blue-50 dark:bg-blue-950/20` background
- `Users` icon before the group name
- Show member count as subtitle: "25 konton" (or "23 av 25 i aktuell data" if some members are missing)
- A thin divider/separator row between groups and individual accounts

### 2.5 Posts Mode — Synthetic Group Row

In posts mode (non-GA), the component shows account-level aggregations. Group handling:

- For SUM fields (`views`, `likes`, `comments`, `shares`, `saves`, `follows`, `total_clicks`, `link_clicks`, `other_clicks`, `interactions`, `engagement`, `post_count`): Sum values from member accounts in `accountData`.
- For `reach`, `average_reach`: Show "–"
- For `posts_per_day`: Show "–" (or recalculate from `earliest_post` / `latest_post` across members if desired — "–" is safer for now)
- For `account_reach` columns (per-month reach): Show "–"

---

## 3. "Skapa grupp" Button in Views

### 3.1 TrendAnalysisView

Add a small button below the account selection list:

```jsx
<button
  onClick={() => setGroupDialogOpen(true)}
  className="mt-2 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
>
  <Users className="w-3.5 h-3.5" />
  Skapa kontogrupp
</button>
```

This opens `GroupCreateDialog` with:
- `source`: `gaListensMode ? 'ga_listens' : 'posts'`
- `availableAccounts`: current `gaAccountList` or `accountList`
- `editGroup`: null (create mode)

After save, call `onGroupsChanged()` to refresh groups in MainView.

### 3.2 AccountView

Same pattern — add the button near the account list / above the table. Only visible when there are accounts to group.

---

## 4. MainView Prop Passing

Update MainView.jsx to pass the new props to both views:

```jsx
<AccountView
  selectedFields={selectedFields}
  platform={apiPlatform}
  periodParams={periodParams}
  gaListensMode={platformFilter === 'ga_listens'}
  accountGroups={accountGroups}
  onGroupsChanged={refreshAccountGroups}
/>

<TrendAnalysisView
  platform={apiPlatform}
  periodParams={periodParams}
  gaListensMode={platformFilter === 'ga_listens'}
  accountGroups={accountGroups}
  onGroupsChanged={refreshAccountGroups}
/>
```

---

## 5. Edge Cases to Handle

### 5.1 Empty group (no members match current data)

When a group has members but none exist in the current dataset (e.g., data was deleted and not reimported):
- **Account list:** Show group as disabled/greyed out with tooltip "Inga matchande konton i vald period"
- **If selected anyway:** Produce a flat-zero series (all months = 0) — don't crash

### 5.2 Partial match

Some group members exist, others don't. This is normal (e.g., a station had no data one month).
- Aggregate only existing members. No warning needed during normal display.
- In the account list, optionally show "23/25" next to the group name to indicate coverage.

### 5.3 GA batch delete interaction

When GA accounts are deleted (v2.2.0 batch delete), groups remain intact (their member keys persist in DB). On next render, the group simply has fewer matching accounts. No special handling needed — the "no match" logic from 5.1 covers the extreme case.

### 5.4 Metric switch while group is selected

If user switches to a non-summable metric (`reach`, `account_reach`) while a group is selected:
- Auto-switch to `interactions` (or first available summable metric)
- Show brief toast/notice: "Räckvidd kan inte aggregeras för kontogrupper. Bytte till Interaktioner."

---

## 6. Verification Plan

### TrendAnalysisView (GA mode)
1. Create a group "Alla P4" with 5 GA accounts
2. Open Trendanalys in GA mode → group appears at top of account list with Users icon
3. Select group → graph shows one aggregated line
4. Select group + one individual account → two lines, group line is thicker
5. Verify values: group line value for any month = sum of the 5 member accounts for that month
6. Switch to `account_reach` metric → metric auto-switches, shows notice

### TrendAnalysisView (Posts mode)
1. Create a group with 3 Facebook accounts
2. Select group → one aggregated trend line
3. Verify SUM aggregation for `views`, `interactions`
4. Select `reach` → auto-switch occurs

### AccountView (GA summary mode)
1. Group row appears at top with correct summed `total_listens`
2. Individual accounts listed below with divider
3. Group row shows member count

### AccountView (GA monthly mode)
1. Group row shows summed listens per month

### AccountView (Posts mode)
1. Group row shows "–" for reach fields
2. Group row shows correct SUM for `views`, `interactions`, etc.

### Edge cases
1. Delete all GA data → group shows as disabled
2. Delete group from ImportManager → disappears from all views immediately
3. Create group from TrendAnalysisView "Skapa grupp" button → works, group appears

---

## Files Changed (summary)

| File | Action |
|---|---|
| `src/renderer/components/TrendAnalysisView/TrendAnalysisView.jsx` | **EDIT** — major changes |
| `src/renderer/components/AccountView/AccountView.jsx` | **EDIT** — major changes |
| `src/renderer/components/MainView/MainView.jsx` | **EDIT** — pass new props |

---

## Implementation Notes for Claude Code

- **Read before writing.** The pseudocode in this directive shows the aggregation logic and data flow intent. Actual variable names, state shapes, and rendering patterns may differ from what's shown here. Always match the real code.
- **Do not refactor existing code** unless necessary for the integration. The goal is surgical insertion of group logic.
- The `accountKey()` helper function already exists in TrendAnalysisView — reuse it. Read the file to find its exact signature.
- The `__group__` prefix in keys is chosen to avoid collision with real account names. It's used purely as a client-side identifier.
- `CHART_COLORS` array already exists — groups will just use the next available color in sequence.
- Check if the `Users` icon from lucide-react is already imported in the project. If not, add the import.
- When expanding group member keys for the API call, deduplicate — a user might select a group AND one of its members individually.
- Run the app and test manually after each major sub-step (account list injection, aggregation logic, visual styling) rather than implementing everything at once.
