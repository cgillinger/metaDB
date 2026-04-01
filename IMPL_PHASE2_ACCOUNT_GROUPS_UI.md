# Implementation Directive — Account Groups: Phase 2 (Group Management UI)

**Version bump:** None (still 2.3.0 — part of same feature)
**Model:** Sonnet
**Commit message:** `feat(account-groups): add group creation dialog and management UI`

**Prerequisite:** Phase 1 (backend) must be complete and verified.

---

## Repo Access

You have full access to the Git repository. **Always read the actual source files before making changes** — do not rely solely on the code samples in this directive. The samples illustrate intent and patterns, but the repo is the source of truth.

Key files to read first:
- `src/renderer/components/ImportManager/ImportManager.jsx` — understand existing structure before adding the GroupManager section
- `src/renderer/components/MainView/MainView.jsx` — understand state management and how props flow to child views
- `src/utils/apiClient.js` — verify the Phase 1 API methods are in place
- `src/renderer/components/ui/` — check which shadcn components are available (Dialog, Checkbox, Input, Button, etc.)
- `src/renderer/components/AccountView/AccountView.jsx` — see how GA account lists are currently built (needed for the account picker in the dialog)

---

## Overview

This phase adds the UI for creating, viewing, editing, and deleting account groups. It does NOT yet integrate groups into AccountView or TrendAnalysisView data display — that's Phase 3.

Components to create/modify:
1. `GroupCreateDialog` — modal for creating/editing a group
2. `GroupManager` — section in ImportManager for listing/deleting groups
3. State in `MainView` — load groups and pass them down

---

## 1. GroupCreateDialog Component

Create `src/renderer/components/AccountGroups/GroupCreateDialog.jsx`:

### Props

```js
/**
 * @param {boolean} open - Dialog visibility
 * @param {Function} onOpenChange - Toggle dialog
 * @param {'ga_listens'|'posts'} source - Which data source this group is for
 * @param {Array<{account_name: string, platform: string, key: string}>} availableAccounts
 *   - All accounts available for selection. `key` is the composite "name::platform" string.
 * @param {{id: number, name: string, members: string[]}|null} editGroup
 *   - If provided, dialog is in edit mode with pre-filled values. null = create mode.
 * @param {Function} onSave - Called with the saved group after successful API call.
 *   Signature: (savedGroup) => void
 */
```

### Behavior

1. **Name field:** Text input, pre-filled with `editGroup.name` or "Alla P4" (as suggestion) in create mode.

2. **Account list:** Scrollable checkbox list of all `availableAccounts`.
   - In **create mode**: Pre-select accounts whose `account_name` matches `/^P4\s/i`. This is a suggestion only — the user can modify freely.
   - In **edit mode**: Pre-select accounts whose `key` is in `editGroup.members`.
   - Show a "Markera alla / Avmarkera alla" toggle at the top.
   - Each row shows `account_name` and a subtle platform badge.

3. **Stale member indicator (edit mode only):** If `editGroup.members` contains keys that are NOT in `availableAccounts`, show them at the bottom with a warning icon and text: "Finns ej i aktuell data". These are displayed but not checkable — they will be dropped on save.

4. **Save button:** Calls `api.createAccountGroup(name, source, selectedKeys)` or `api.updateAccountGroup(editGroup.id, { name, members: selectedKeys })`. Disabled if name is empty or no accounts selected.

5. **Cancel button:** Closes dialog without saving.

### UI Framework

Use the existing shadcn `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` components. Use `Checkbox` from shadcn for the account list. Use `Input` for the name field. Use `Button` for actions. Use `AlertTriangle` from lucide for stale member warnings.

### Layout

```
┌─────────────────────────────────────────┐
│ Skapa kontogrupp              [X]       │
│                                         │
│ Gruppnamn: [Alla P4_________________]   │
│                                         │
│ Välj konton:                            │
│ [✓] Markera alla                        │
│ ┌─────────────────────────────────────┐ │
│ │ [✓] P4 Blekinge          ga_listens│ │
│ │ [✓] P4 Dalarna            ga_listens│ │
│ │ [ ] P4 Extra              ga_listens│ │
│ │ [✓] P4 Gävleborg          ga_listens│ │
│ │ ...                                 │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ⚠ Finns ej i aktuell data:             │
│   P4 Testkanal                          │
│                                         │
│              [Avbryt]  [Spara grupp]    │
└─────────────────────────────────────────┘
```

The account list should have `max-height: 320px` with `overflow-y: auto`.

Sort accounts alphabetically by `account_name`.

---

## 2. GroupManager Section in ImportManager

Modify the existing ImportManager component (likely `src/renderer/components/ImportManager/ImportManager.jsx`).

### What to add

A new section **below** existing import/GA management sections, titled "Kontogrupper":

```
┌─────────────────────────────────────────┐
│ Kontogrupper                            │
│                                         │
│ Inga grupper skapade ännu.              │
│                                         │
│  — OR —                                 │
│                                         │
│ ┌─ Alla P4 (GA-lyssningar) ──────────┐ │
│ │ 25 konton  •  Skapad 2026-01-15    │ │
│ │                    [Redigera] [🗑]  │ │
│ └─────────────────────────────────────┘ │
│ ┌─ Lokala FB-konton (Inlägg) ────────┐ │
│ │ 12 konton  •  Skapad 2026-02-01    │ │
│ │                    [Redigera] [🗑]  │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Rensa alla grupper]                    │
└─────────────────────────────────────────┘
```

### Behavior

- Load groups on mount via `api.getAccountGroups()`.
- Each group card shows: name, source badge ("GA-lyssningar" or "Inlägg"), member count, creation date.
- **Redigera** button opens `GroupCreateDialog` in edit mode. Need to fetch available accounts for the group's source to populate the dialog. For `ga_listens`: use `api.getGAListens()` to get distinct account names. For `posts`: use `api.getAccounts({ fields: 'views' })` to get account list.
- **Delete (🗑)** button: Confirmation dialog ("Ta bort gruppen 'Alla P4'? Underliggande konton påverkas inte."), then calls `api.deleteAccountGroup(id)`.
- **Rensa alla grupper** button: Only shown when groups exist. Confirmation dialog ("Ta bort alla kontogrupper? Denna åtgärd kan inte ångras."), then calls `api.deleteAllAccountGroups()`.
- After any mutation (create/edit/delete), refresh the group list AND call the parent callback so MainView can update its state.

### Integration with GroupCreateDialog

GroupManager needs to be able to open GroupCreateDialog. Manage dialog state locally within GroupManager:

```js
const [dialogOpen, setDialogOpen] = useState(false);
const [editingGroup, setEditingGroup] = useState(null);
const [dialogAccounts, setDialogAccounts] = useState([]);
const [dialogSource, setDialogSource] = useState('ga_listens');
```

When opening the edit dialog, fetch the appropriate account list first, then open.

---

## 3. MainView State Management

In `MainView.jsx`, add state for account groups that persists across view switches:

### State

```js
const [accountGroups, setAccountGroups] = useState([]);
```

### Load on mount

```js
useEffect(() => {
  const fetchGroups = async () => {
    try {
      const result = await api.getAccountGroups();
      setAccountGroups(result.groups || []);
    } catch (err) {
      console.error('Fel vid hämtning av kontogrupper:', err);
    }
  };
  fetchGroups();
}, []);
```

### Refresh callback

Create a callback that ImportManager (and later, other components) can call after group mutations:

```js
const refreshAccountGroups = useCallback(async () => {
  try {
    const result = await api.getAccountGroups();
    setAccountGroups(result.groups || []);
  } catch (err) {
    console.error('Fel vid hämtning av kontogrupper:', err);
  }
}, []);
```

### Pass to children

Pass `accountGroups` and `refreshAccountGroups` to:
- `ImportManager` (for GroupManager section, plus the refresh callback)
- `AccountView` (for Phase 3)
- `TrendAnalysisView` (for Phase 3)

For now in Phase 2, only ImportManager needs them. Add the props to AccountView and TrendAnalysisView in Phase 3.

```jsx
<TabsContent value="imports">
  <ImportManager
    onImportsChanged={handleImportsChanged}
    accountGroups={accountGroups}
    onGroupsChanged={refreshAccountGroups}
  />
</TabsContent>
```

---

## 4. "Skapa grupp" Button Placement (Preparation for Phase 3)

In Phase 3, a "Skapa grupp" button will appear in TrendAnalysisView and AccountView's account lists. For now, the only entry point for group creation is via the ImportManager section. Phase 3 will add contextual creation buttons that reuse GroupCreateDialog.

---

## Files Changed (summary)

| File | Action |
|---|---|
| `src/renderer/components/AccountGroups/GroupCreateDialog.jsx` | **CREATE** |
| `src/renderer/components/ImportManager/ImportManager.jsx` | **EDIT** — add GroupManager section |
| `src/renderer/components/MainView/MainView.jsx` | **EDIT** — add accountGroups state + refresh callback, pass to ImportManager |

---

## Verification Plan

1. Navigate to Databas-fliken → "Kontogrupper" section visible, shows "Inga grupper skapade ännu"
2. No "Skapa grupp" button in ImportManager (creation comes from Phase 3 buttons OR by clicking "Redigera" after Phase 3 — wait, we need a way to create in Phase 2 too)

**CORRECTION:** Add a "+ Ny grupp" button in the GroupManager section header. When clicked:
- Show a source selector (radio: "GA-lyssningar" / "Inlägg")
- Fetch the account list for that source
- Open GroupCreateDialog in create mode

3. Create a group "Alla P4" with GA source → verify it appears in the list with correct count
4. Click Redigera → dialog opens pre-filled → change name → save → list updates
5. Click 🗑 → confirmation → group deleted
6. Create 2 groups → "Rensa alla grupper" → both gone
7. Close and reopen app → groups persist (DB-backed)
