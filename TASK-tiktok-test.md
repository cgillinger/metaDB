# Testuppdrag — TikTok-import i metaDB

## Kontext

På branchen `claude/wonderful-meitner-x5ajO` har en webbsessions-Claude lagt till
TikTok som tredje plattform (utöver Facebook/Instagram/Google Analytics). Det finns
två CSV-typer från TikTok Creator Studio:

- **Video-CSV** (per inlägg): kolumner `Videotitel, Videolänk, Publiceringstid,
  Videovisningar, Gilla-markeringar, Kommentarer, Delningar, Lägg till i Favoriter`.
  Konto-handlen extraheras ur Videolänk-URL:n (`https://www.tiktok.com/@p3dingata/video/<id>`).
- **Översikt-CSV** (per dag, kontonivå): kolumner `Datum, Videovisningar, Målgrupp
  som nåtts, Profilvisningar, Gilla-markeringar, Delningar, Kommentarer, Nya följare,
  Tappade följare` + ev. affärsfält. Konto finns INTE i filen — användaren måste
  välja vid uppladdning.

Tre commits ligger på branchen:
- `0897ba1` backend-grund (migration 008, parser, importerare, route)
- `9dc7f55` UI (FileUploader, MainView, PlatformBadge, HiddenAccounts)
- `eaeffe3` slutförande (PlatformTrend, Översikt-kort, beskrivnings-dialog, export)

App-version 2.19.0.

## Förberedelse

```bash
git fetch origin claude/wonderful-meitner-x5ajO
git checkout claude/wonderful-meitner-x5ajO
git log --oneline -5    # bekräfta de 3 TikTok-commiterna ligger överst
```

Hitta produktionsappens URL/port (kolla `docker compose ps` eller motsvarande). All
testning sker mot körande prod-instansen — starta INTE en separat dev-server.

CSV-testdata behöver tillhandahållas av användaren — fråga efter två par:
- "P3 Din Gata"-paret: `<månad>P3_Din_GataVideo.csv` + `<månad>P3_Din_Gata_versikt.csv`
- "P3 Nyheter"-paret: motsvarande Video + Översikt

Om CSV-erna ligger i `data/`-mappen eller liknande använd dem direkt; annars be om
uppladdning/sökväg.

## Playwright-testflöden

### Test 1 — Detektering + handle-extraktion (Video-CSV)

1. Navigera till appen, klicka "Lägg till data"
2. Släpp in `<månad>P3_Din_GataVideo.csv` via dra-och-släpp eller filväljaren
3. **Verifiera**:
   - Svart badge "TikTok video" syns på filraden
   - "Konto:" visar `@p3dingata` i grå monospace-chip
   - Inputfältet "Visningsnamn" innehåller `P3 Din Gata` (härlett från filnamn)
   - Ingen röd validering — "Importera"-knappen är aktiv

### Test 2 — Tvingad konto-koppling (Översikt-CSV)

1. Innan något TikTok-konto är importerat: släpp in `<månad>P3_Din_Gata_versikt.csv`
   ensamt
2. **Verifiera**:
   - Svart badge "TikTok översikt"
   - Dropdown med röd kantfärg + texten "Inga TikTok-konton ännu — ladda upp en
     Video-CSV först."
   - "Importera"-knappen är **disabled** med tooltip "Välj konto för alla
     TikTok-Översikt-filer först."
3. Ta bort Översikt-filen, släpp in Video-filen från Test 1 + Översikt-filen
   tillsammans
4. **Verifiera**:
   - Video-filen visar `@p3dingata → P3 Din Gata` (editerbart)
   - Översikt-dropdownen visar nu "P3 Din Gata (@p3dingata)" och förvalt
     (filnamnsmatch)
   - "Importera"-knappen aktiv

### Test 3 — Faktisk import + data syns

1. Importera Video + Översikt för P3 Din Gata (Test 2-fortsättning)
2. Vänta på success-checkmarks
3. **Verifiera via Playwright**:
   - Toaster/meddelande visar "X av Y filer importerades framgångsrikt"
4. Stäng uppladdaren, gå till huvudvyn
5. **Verifiera**:
   - Svart "TikTok"-knapp finns i platformsraden uppe (med inläggsantal)
   - Klick på TikTok-knappen filtrerar PeriodSelector till TikTok-månader
   - I "Per konto"-fliken visas TikTokOverviewSummary-kortet ovanför AccountView med
     kolumnerna: Konto, Dagar, Visningar, Räckvidd/dag (snitt), Topp dagsräckvidd,
     Profilvisningar, Nya/Tappade följare, Netto, Dagsengagemang
   - AccountView nedanför visar P3 Din Gata med Video-CSV-data (visningar, gillar,
     kommentarer, delningar, sparade)
   - Reach-kolumnen är frånvarande/N/A för TikTok (TIKTOK_UNAVAILABLE_FIELDS)

### Test 4 — Andra kontot + parning

1. Importera Video + Översikt för P3 Nyheter på samma sätt
2. **Verifiera**:
   - Båda konton syns i TikTokOverviewSummary
   - AccountView listar båda konton

### Test 5 — Beskrivnings-Dialog

1. I AccountView, klicka raden för P3 Din Gata för att öppna scatter-vyn
2. Gå till "Per inlägg"-fliken
3. Hitta ett TikTok-inlägg med lång beskrivning (Tenstaplan-inlägget från april har
   ~1100 tecken)
4. **Verifiera**:
   - Beskrivningstexten är trunkerad till 3 rader med ellipsis
   - Hover ger hand-pekare (cursor-pointer)
   - Klick öppnar Dialog med titel "Beskrivning" och full text (radbrytningar
     bevarade)
   - Klick på "Stäng" eller utanför stänger dialogen

### Test 6 — Plattformstrend för TikTok

1. Gå till fliken "Plattformstrend"
2. Klicka TikTok-pillen i platform-toggeln
3. **Verifiera**:
   - Chart renderas
   - Linjen "Visningar / inlägg" är synlig
   - Linjen "Räckvidd / inlägg" ligger på 0 (medvetet — TikTok-CSV saknar räckvidd
     per inlägg)
   - Barometerkortet visar trend (om ≥2 månader importerade)

### Test 7 — Trendanalys för TikTok-mått

1. Gå till "Trendanalys"
2. Med TikTok som aktiv plattform, **verifiera fältväljaren**:
   - Synliga: Visningar, Engagemang, Interaktioner, Reaktioner, Kommentarer,
     Delningar, Sparade
   - Frånvarande: Räckvidd, Kontoräckvidd (FB/IG), Totalt antal klick, Följare
3. Välj "Visningar", välj P3 Din Gata och P3 Nyheter
4. **Verifiera**: linjediagram med två linjer renderas

### Test 8 — HiddenAccountsManager för TikTok

1. Gå till "Databas"-fliken
2. Scrolla till "Hantera konton"
3. **Verifiera**:
   - P3 Din Gata och P3 Nyheter listas med svart "TikTok"-badge (Video-data)
   - Båda kontona listas också med svart "TikTok översikt"-badge separat
   - Dölj P3 Nyheter (tiktok_overview)
4. Gå tillbaka till TikTokOverviewSummary
5. **Verifiera**: P3 Nyheter försvinner från Översikt-tabellen men finns kvar i
   AccountView (eftersom bara `tiktok_overview` doldes, inte `tiktok`)
6. Återställ via "Visa" i HiddenAccountsManager

### Test 9 — Export (.xlsx)

1. I Databas-fliken, klicka "Exportera för analys (.xlsx)"
2. Öppna nedladdad fil (eller använd Playwright för att inspektera download-eventet)
3. **Verifiera flikar finns**:
   - `tiktok_posts_monthly` (med kolumnerna account_username, account_name,
     normalized_name, month, post_count, views, likes, comments, shares, saves,
     interactions, engagement, posts_per_day)
   - `tiktok_overview_monthly` (day_count, video_views, avg_daily_reach,
     peak_daily_reach, profile_views, new_followers, lost_followers,
     net_follower_growth, daily_engagement_sum)
   - `tiktok_overview_daily` (rådata per dag)
   - `dim_accounts` har rader med `platform=tiktok` och `platform=tiktok_overview`
   - `_LÄS_MIG` nämner TikTok-flikarna och förklarar `account_username = handle`

### Test 10 — Återimport (UPSERT)

1. Importera samma Översikt-CSV två gånger (samma månad)
2. **Verifiera**:
   - Andra importen lyckas utan duplikat-fel
   - Räkningarna i TikTokOverviewSummary är OFÖRÄNDRADE (samma data, inte
     fördubblad)
3. Importera samma Video-CSV två gånger
4. **Verifiera**: posts_count i Imports-listan visar ingen ökning för andra
   körningen (UPSERT på post_id)

### Test 11 — Radera månad

1. I ImportManager, hitta kortet "TikTok Översikt (per dag)"
2. Klicka soptunne-ikonen på en månad, bekräfta dialogen
3. **Verifiera**:
   - Månaden försvinner från kortet
   - TikTokOverviewSummary uppdateras (om aktivt vald månad — den månaden saknar
     nu data)

## Acceptanskriterier (alla måste passera)

- [ ] Tester 1-11 ovan
- [ ] Inga konsolfel i devtools under normal användning
- [ ] FB/IG-flödet är OPÅVERKAT — importera en gammal FB-CSV och bekräfta att den
  fortfarande fungerar (inga regressioner)
- [ ] `npm test` (i checkat-ut repo) ger 146 pass / 0 fail / 7 skipped

## Kända begränsningar (testa inte)

- Comparison-vyn stödjer inte TikTok (medvetet val)
- Estimated unique clicks är N/A för TikTok (medvetet)
- TikTok kan inte ingå i kontogrupper (medvetet)
- TikTok Översikt-mått som väljbar serie i Trendanalys är INTE implementerat
  (kvarvarande arbete)

## Rapportering

Rapportera tillbaka med:
1. Vilka tester som passerade och vilka som föll
2. Skärmdumpar via Playwright av (a) PerSidan TikTok-toggle aktiverad, (b)
   TikTokOverviewSummary-kortet, (c) beskrivnings-dialog öppen, (d) Plattformstrend
   för TikTok
3. Eventuella regressioner i FB/IG-flöden
4. UX-papperskorgar eller copy-fel

Om något test faller — diagnostisera med `git log`, `Read` på relevant fil, och
`Bash` för API-anrop direkt mot prod-instansen innan du föreslår fix.
