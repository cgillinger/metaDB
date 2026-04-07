
# Direktiv: Dolda konton (Hidden Accounts)

## Sammanfattning

Ny funktion för att dölja konton från alla vyer utan att radera data. Dolda konton filtreras bort i backend-queries och kan återställas via Databas-fliken.

## Designbeslut

- **Icke-destruktivt**: Data finns kvar, döljs bara
- **Backend-centrerad filtrering**: Alla SQL-queries exkluderar dolda konton defaultmässigt. Frontend behöver inte filtrera.
- **Reimport-säkert**: Dolda konton förblir dolda efter reimport av samma CSV
- **Collab-detection**: Dolda konton **exkluderas** från collab-räkning (de är typiskt skräpkonton/collabs redan)

---

## Fas 1 — Data & Service (Sonnet)

### 1.1 Migration: `server/db/migrations/004_hidden_accounts.sql`

```sql
CREATE TABLE IF NOT EXISTS hidden_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  platform TEXT NOT NULL,        -- 'facebook', 'instagram', 'ga_listens'
  hidden_at TEXT DEFAULT (datetime('now')),
  UNIQUE(account_name, platform)
);
CREATE INDEX IF NOT EXISTS idx_hidden_accounts_lookup ON hidden_accounts(account_name, platform);
```

### 1.2 Service: `server/services/hiddenAccounts.js`

Exportera:
- `hide(accountName, platform)` — INSERT OR IGNORE
- `unhide(accountName, platform)` — DELETE
- `listHidden()` — alla dolda
- `isHidden(accountName, platform)` — boolean
- `hiddenAccountSQL(tableAlias)` — returnerar SQL-fragment:
  ```
  AND (tableAlias.account_name, tableAlias.platform) NOT IN (SELECT account_name, platform FROM hidden_accounts)
  ```
  Om `tableAlias` saknas, skippa prefix. För tabeller utan platform-kolumn (account_reach, ga_listens), returnera variant som bara filtrerar på account_name + matchande platform-literal.

Exportera även convenience-varianter:
- `hiddenPostsFilter(alias)` — för posts-tabellen (har platform)
- `hiddenReachFilter(alias)` — för account_reach (alltid platform='facebook')
- `hiddenGAFilter(alias)` — för ga_listens (alltid platform='ga_listens')

### 1.3 REST API: `server/routes/hiddenAccounts.js`

- `GET /api/hidden-accounts` → `listHidden()`
- `POST /api/hidden-accounts` body: `{ accountName, platform }` → `hide()`
- `DELETE /api/hidden-accounts` body: `{ accountName, platform }` → `unhide()`

Registrera i `server/index.js` FÖRE övriga routes.

### 1.4 apiClient: `src/utils/apiClient.js`

Lägg till:
- `getHiddenAccounts()`
- `hideAccount(accountName, platform)`
- `unhideAccount(accountName, platform)`

### Repo Access — Fas 1
Läs innan implementation:
- `server/db/connection.js` (migrationslogik)
- `server/db/migrations/001_account_reach.sql` (mönster)
- `server/db/migrations/002_ga_listens.sql` (mönster)
- `server/index.js` (route-registrering)
- `src/utils/apiClient.js` (API-mönster)

---

## Fas 2 — Backend-filtrering (Sonnet)

Applicera dolda-konto-filter i **varje** funktion nedan. Använd helper-funktionerna från fas 1. Markera varje ändring med kommentaren `// Hidden accounts filter`.

### 2.1 `server/routes/accounts.js` — GET `/api/accounts`
- Filtrera posts-queryn (account_name + platform NOT IN hidden_accounts)
- Filtrera account_reach-queryn (account_name NOT IN hidden_accounts WHERE platform='facebook')
- Filtrera reach-only accounts-sektionen

### 2.2 `server/routes/posts.js` — GET `/api/posts`
- Lägg till hidden-filter i WHERE-clause

### 2.3 `server/routes/posts.js` — DELETE `/api/posts/by-account`
- Ingen ändring (explicit radering bör fortfarande fungera)

### 2.4 `server/routes/postTypes.js` — GET `/api/post-types`
- Lägg till hidden-filter i WHERE-clause

### 2.5 `server/routes/trends.js` — GET `/api/trends`
- Filtrera posts-queryn
- Filtrera account_reach-queryn (metric=account_reach path)

### 2.6 `server/routes/gaListens.js` — GET `/api/ga-listens/summary`
- Filtrera ga_listens-queryn

### 2.7 `server/routes/imports.js` — GET `/api/imports/coverage`
- Filtrera post-counts per month (så dolda konton inte räknas i coverage)
- Filtrera ga_listens count

### 2.8 `server/services/collabDetector.js` — `redetectAllCollabs()`
- Exkludera dolda konton från accountCounts-queryn
- Dolda konton får varken is_collab=0 eller is_collab=1 (lämna oförändrade)

### 2.9 Account groups — `GroupCreateDialog` kontolista
- Den hämtar konton via `/api/accounts` → redan filtrerad efter 2.1
- Verifiera att detta fungerar korrekt

### Repo Access — Fas 2
Läs **hela** filen innan ändring:
- `server/routes/accounts.js`
- `server/routes/posts.js`
- `server/routes/postTypes.js`
- `server/routes/trends.js`
- `server/routes/gaListens.js`
- `server/routes/imports.js`
- `server/services/collabDetector.js`

---

## Fas 3 — UI i Databas-fliken (Sonnet)

### 3.1 Ny komponent: `src/renderer/components/HiddenAccountsManager/HiddenAccountsManager.jsx`

**Sektion: "Hantera konton"** — visas i ImportManager eller som egen sub-tab.

Hämta alla konton via `/api/accounts?includeHidden=true` (kräver att fas 2 stödjer query-param `includeHidden`). Alternativt: hämta synliga konton + dolda konton separat och merga.

**Rekommenderad approach**: Hämta separata listor:
1. `GET /api/accounts` (synliga)
2. `GET /api/hidden-accounts` (dolda)

Visa som tabell med kolumner:
| Konto | Plattform | Poster | Status | Åtgärd |
|-------|-----------|--------|--------|--------|
| Alexander Lundholm | instagram | 3 | Synlig | [Dölj] |
| ... | | | Dold | [Visa] |

- Toggle-knapp per rad (Dölj/Visa)
- Bulk-markering + "Dölj valda" för snabb rensning
- Dolda konton visas i en collapsed sektion "Dolda konton (N st)" med möjlighet att expandera och återställa
- Bekräftelsedialog vid "dölj" med text: "Kontot döljs från alla vyer. Data raderas inte."

### 3.2 Integrera i ImportManager

Lägg till `HiddenAccountsManager` som en ny Card-sektion i `ImportManager.jsx`, efter importlistan. Alternativt: Egen Tab i Databas-vyn om ImportManager blir för lång.

### 3.3 Callback: refresha data

Efter hide/unhide, anropa `onImportsChanged()` (befintlig callback) så att MainView refreshar sina data (konton, coverage etc).

### Repo Access — Fas 3
- `src/renderer/components/ImportManager/ImportManager.jsx`
- `src/renderer/components/MainView/MainView.jsx` (onImportsChanged-mönstret)
- `src/renderer/components/AccountView/AccountView.jsx` (kontotabell-mönster att följa)
- `src/utils/apiClient.js`

---

## Versionshantering

**Minor bump** (ny kapabilitet): t.ex. 1.X.0 → 1.(X+1).0
Uppdatera BÅDE `package.json` och `src/utils/version.js`.

---

## Edge cases att bevaka

1. **Konto finns i posts + account_reach + ga_listens** — döljning måste filtrera alla tre
2. **Konto döljs → reimport av CSV** — kontot importeras men förblir dolt (hidden_accounts-tabellen styr)
3. **Konto i en grupp döljs** — gruppen tappar den medlemmen. Grupp-aggregering bör hantera detta (stale member-logiken från account groups fas 3)
4. **Alla konton döljs** — UI bör visa tom-state, inte krascha
5. **Kontonamn med special-tecken** — se till att SQL-parametrisering fungerar korrekt (prepared statements)
