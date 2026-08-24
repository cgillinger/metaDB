# TASK: Spärr mot FB-exporter med daglig nedbrytning

> **Modell:** Sonnet räcker.
> **Repo:** metaDB
> **Status:** Ej påbörjad. Identifierad 2026-08-24.
> **Krav:** Får inte avvisa någon filtyp som importeras korrekt idag. Lägg till spärr — ändra inte befintlig parsningslogik.

---

## Problemet

Meta Business Suite kan exportera Facebook-statistik i **två former som ser nästan
likadana ut**:

| | Inläggsexport (rätt) | Daglig nedbrytning (fel) |
|---|---|---|
| Rader | en per inlägg | en per inlägg **och dag** |
| `Visningar`-kolumn | ja | **nej** |
| `Datum`-kolumn | ja | ja |
| Unika `Publicerings-id` / rader | ≈ 1:1 | ≈ 1:28 |
| Kolumner (exempel) | 40 | 26 |

**Importern släpper igenom den senare utan invändning**, och resultatet är tyst
felaktig data:

- Varje inlägg får `views = 0`, eftersom `Visningar` inte finns i filen.
- Dedupen kollapsar de ~28 dagsraderna till en, så `interactions` blir en enskild
  dags värde i stället för månadstotalen.
- Månaden ser ut att ha data, vilket är sämre än en tom lucka — luckan syns,
  felvärdena gör det inte.

### Bevis (torrkörning 2026-08-24)

Filen `Feb-01-2026_Feb-28-2026_2260327001369726.csv` (Radio Romano, 224 rader,
8 reels × 28 dagar) gav via `parseCSV`:

```
plattform: facebook | månad: 2026-02 | poster efter dedup: 8
views-värden:  [0,0,0,0,0,0,0,0]
interactions:  [47,40,103,328,116,77,150,276]
stats: { totalRows: 224, parsedPosts: 8, duplicatesRemoved: 216 }
```

De verkliga månadstotalerna för samma åtta inlägg var
`117, 133, 386, 819, 227, 330, 1104, 1985` — alltså mellan 2× och 7× fel.

Filen importerades aldrig; felet upptäcktes i torrkörning.

---

## Åtgärd

Lägg en spärr i FB-inläggsimporten som avvisar filer med daglig nedbrytning,
i **samma mönster som de befintliga spärrarna**:

- `server/services/reachImporter.js:42` — avvisar filer som inte är räckviddsexport.
- `server/services/reachImporter.js:49` — avvisar viewers-filer med hänvisning till rätt ingång.
- `server/services/viewersImporter.js:58-65` — kräver rätt `Views_Source`-prefix.

### Detektering

Två signaler, båda måste vägas in — `Datum` ensamt duger **inte**, eftersom en
korrekt inläggsexport också har den kolumnen (verifierat mot
`Nov-01-2025_Nov-30-2025_1723676025555044.csv`, 40 kolumner, 1 968 unika id på
1 975 rader).

1. **`Visningar` saknas** i en fil som i övrigt ser ut som en FB-inläggsexport.
2. **Radie unika `Publicerings-id` / antal rader ligger långt under 1** — förslag:
   avvisa under ~0,5. Den korrekta novemberfilen ligger på 0,996; den felaktiga
   februarifilen på 0,036.

Signal 1 är den enkla och entydiga. Signal 2 fångar även en framtida variant som
råkar ha en visningskolumn men fortfarande är dagsuppdelad — ta med den om det går
att göra utan att störa TikTok- och IG-vägarna.

### Felmeddelande

Svenskt klarspråk, samma ton som befintliga spärrar, och det ska säga vad
användaren gör i stället:

> Filen är en daglig nedbrytning per inlägg, inte en inläggsexport
> (kolumnen Visningar saknas och varje inlägg förekommer en gång per dag).
> Exportera om från Meta Business Suite och välj inläggsvyn, inte videostatistiken.

### Var

`server/services/csvProcessor.js` — efter plattformsdetektering, före
postbyggandet. Får bara gälla Facebook-inläggsvägen. Kontrollera att
TikTok-vägarna (`tiktok_video`, `tiktok_overview`) och IG inte träffas: TikTok
Översikt är per definition dagsuppdelad och har en egen tabell och egen importväg.

---

## Testfall

Nya tester i `server/services/csvProcessor.test.js`:

1. **Avvisar** en FB-fil utan `Visningar` där varje `Publicerings-id` förekommer 28 gånger.
2. **Accepterar** en normal FB-inläggsexport med `Datum`-kolumn och ~1:1-radie
   (regressionsskydd — det var här min första analys tog fel).
3. **Accepterar** TikTok Översikt-CSV oförändrat.
4. **Accepterar** IG-export oförändrat.
5. Felmeddelandet nämner både `Visningar` och vad användaren ska göra.

Kör hela sviten: `npm test` (`node --test`, inte vitest). Baslinjen 2026-08-24 var
202 pass / 0 fail.

---

## Referensfiler

Fanns vid identifieringstillfället, kan ha flyttats:

| Fil | Roll |
|---|---|
| `~/Hämtningar/Feb-01-2026_Feb-28-2026_2260327001369726.csv` | felaktig: daglig nedbrytning, 224 rader, 8 id |
| `~/Hämtningar/Nov-01-2025_Nov-30-2025_1723676025555044.csv` | korrekt: inläggsexport, 1 975 rader, 1 968 id |

---

## Relaterat, men separat

**Radio Romano saknar februari 2026** i databasen. Det beror inte på den här buggen
utan på att sidan fallit ur den ordinarie riks-exporten: `FB Riks Nov-01-2025`
innehöll 41 sidor inklusive Radio Romano (141 rader), medan `FB Riks Feb-01-2026`
har 39 sidor och saknar kontot helt. Det finns inte heller i lokalt-exporten.
Åtgärden är att få sidan tillbaka i exporturvalet och importera februari — inte en
kodändring. Värt att kontrollera om fler konton försvunnit på samma sätt.
