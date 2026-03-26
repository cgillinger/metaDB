# Prompter för Claude Code: Radera konto från vald period

Kör dessa i ordning. Varje prompt är ett självständigt steg.

---

## Prompt 1: Backend-endpoint

```
Läs TASK_delete_account_by_period.md (ligger i repots rot eller bifogad).

Implementera steg 1: Ny DELETE-endpoint i server/routes/posts.js.

Endpoint: DELETE /api/posts/by-account
Query-params: accountName, platform, plus periodfilter (months ELLER dateFrom+dateTo).

Regler:
- accountName och platform är obligatoriska — returnera 400 utan dem
- Periodfilter är OBLIGATORISKT — returnera 400 om buildPeriodConditions() ger 0 villkor (skydd mot att radera allt)
- platform måste vara 'facebook' eller 'instagram'
- Använd buildPeriodConditions() från server/utils/periodFilter.js (redan importerad i filen)
- Kör redetectAllCollabs() från server/services/collabDetector.js efter DELETE
- Returnera { deleted: antal, accountName, platform }

Titta på hur DELETE /api/imports/:id i server/routes/imports.js gör det — följ samma mönster för felhantering och collabDetector-anrop.
```

---

## Prompt 2: API-klient

```
Lägg till en ny metod i src/utils/apiClient.js i api-objektet:

deleteAccountPosts(accountName, platform, periodParams)

Den ska göra DELETE till /api/posts/by-account med accountName, platform och periodParams som query-params via URLSearchParams. Använd samma handleResponse som övriga metoder.

Inget annat ska ändras i filen.
```

---

## Prompt 3: Frontend — AccountView

```
Läs TASK_delete_account_by_period.md för full specifikation.

Ändra src/renderer/components/AccountView/AccountView.jsx:

1. Lägg till tre state-variabler: showDeleteColumn (false), deleteConfirm (null), deleteLoading (false), refreshCounter (0)

2. Lägg till refreshCounter i dependency-arrayen för useEffect som hämtar kontodata (den med fetchData)

3. I verktygsfältet (div med CSV/Excel-knappar): lägg till en Switch + Label "Visa raderingskolumn" (text i text-red-600). Dölj helt om gaListensMode är true.

4. I TableHeader: lägg till en kolumn "Radera" (text-red-500, w-12, text-center) FÖRE "Länk"-kolumnen. Visa bara om showDeleteColumn är true.

5. I Totalt-raden: lägg till tom TableCell på samma position om showDeleteColumn.

6. I varje kontorad: lägg till en Trash2-ikon-knapp FÖRE länk-cellen om showDeleteColumn. Knappen ska INTE visas för _reachOnly-konton. onClick sätter deleteConfirm med accountName, platform och post_count.

7. Bekräftelsedialog: Visa en Alert variant="destructive" ovanför tabellen när deleteConfirm !== null. Visa kontonamn, plattform, antal poster. Två knappar: Avbryt och "Ja, radera" (variant destructive). Följ exakt samma mönster som ImportManager.jsx använder för sin raderingsdialog.

8. handleDeleteAccount: anropar api.deleteAccountPosts med deleteConfirm.accountName, deleteConfirm.platform, periodParams. Vid success: nollställ deleteConfirm, incrementera refreshCounter. Vid fel: visa alert med felmeddelande.

Importera det som saknas (Trash2, Alert, AlertCircle, AlertTitle, AlertDescription) — kontrollera först vad som redan importeras så du inte skapar dubletter.

VIKTIGT: Ändra INGET i GA-listens-blocket (early return). Raderingskolumnen ska aldrig synas i GA-läget.
```

---

## Prompt 4: Verifiering

```
Granska ändringarna du gjort i dessa tre filer:
- server/routes/posts.js
- src/utils/apiClient.js
- src/renderer/components/AccountView/AccountView.jsx

Kontrollera:
1. DELETE-endpointen kräver periodfilter (returnerar 400 utan det)
2. _reachOnly-konton har INGEN papperskorg
3. showDeleteColumn default är false
4. account_reach-tabellen rörs ALDRIG
5. ga_listens-tabellen rörs ALDRIG
6. redetectAllCollabs() anropas efter radering
7. Inga import-dubletter i AccountView
8. Bekräftelsedialogen visar kontonamn, plattform och antal poster

Rapportera eventuella problem.
```
