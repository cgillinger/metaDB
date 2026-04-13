import React from 'react';
import { Card, CardContent } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const MetricTable = ({ caption, rows }) => (
  <div className="mb-8">
    <h4 className="text-base font-semibold mb-3">{caption}</h4>
    <div className="overflow-x-auto border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[130px]">Mätpunkt</TableHead>
            <TableHead className="min-w-[110px]">Intern nyckel</TableHead>
            <TableHead className="min-w-[250px]">Beskrivning</TableHead>
            <TableHead className="min-w-[130px]">Källa</TableHead>
            <TableHead className="min-w-[90px]">Summerbar?</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell><code className="text-sm bg-muted px-1 py-0.5 rounded">{r.key}</code></TableCell>
              <TableCell className="text-sm text-muted-foreground">{r.desc}</TableCell>
              <TableCell className="text-sm">{r.source}</TableCell>
              <TableCell className="text-sm">{r.summable}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </div>
);

const FB_METRICS = [
  { name: 'Visningar', key: 'views', desc: 'Hur många gånger inlägget visats — oavsett om det är samma person som sett det flera gånger. Samma person kan räknas flera gånger.', source: 'CSV: "Visningar"', summable: 'Ja' },
  { name: 'Räckvidd', key: 'reach', desc: 'Hur många unika personer som sett inlägget. Varje person räknas bara en gång, oavsett hur många gånger de sett det.', source: 'CSV: "Räckvidd"', summable: 'Nej — genomsnitt vid aggregering' },
  { name: 'Reaktioner', key: 'likes', desc: 'Hur många gånger någon reagerat på inlägget med gilla, hjärta, haha, arg eller liknande.', source: 'CSV: "Reaktioner"', summable: 'Ja' },
  { name: 'Kommentarer', key: 'comments', desc: 'Hur många kommentarer inlägget fått.', source: 'CSV: "Kommentarer"', summable: 'Ja' },
  { name: 'Delningar', key: 'shares', desc: 'Hur många gånger inlägget delats vidare av en användare.', source: 'CSV: "Delningar"', summable: 'Ja' },
  { name: 'Interaktioner', key: 'interactions', desc: 'Summan av reaktioner, kommentarer och delningar. Appen räknar alltid ihop dessa tre direkt — inte från Metas egna sammanslagna siffra.', source: 'Beräknad', summable: 'Ja' },
  { name: 'Engagemang', key: 'engagement', desc: 'Summan av reaktioner, kommentarer, delningar och alla typer av klick. Ett bredare mått som fångar all aktivitet på inlägget.', source: 'Beräknad', summable: 'Ja' },
  { name: 'Totalt antal klick', key: 'total_clicks', desc: 'Hur många gånger någon klickat var som helst på inlägget — på en länk, på bilden, på kontonamnet och så vidare.', source: 'CSV: "Totalt antal klick"', summable: 'Ja' },
  { name: 'Länkklick', key: 'link_clicks', desc: 'Hur många gånger någon klickat på en länk i inlägget och lämnat Facebook.', source: 'CSV: "Länkklick"', summable: 'Ja' },
  { name: 'Övriga klick', key: 'other_clicks', desc: 'Klick på inlägget som inte gick till en extern länk — till exempel att klicka för att se hela bilden eller expandera texten.', source: 'CSV: "Övriga klick"', summable: 'Ja' },
  { name: 'Kontoräckvidd', key: 'account_reach', desc: 'Hur många unika personer som sett något av kontots inlägg under en hel månad. Hämtas separat från Meta, inte från exportfilerna för enskilda inlägg.', source: 'API-export', summable: 'Nej — kan inte summeras meningsfullt' },
  {
    name: 'Uppsk. unika länkklickare',
    key: 'estimated_unique_clicks',
    desc: 'Uppskattning av hur många unika personer som klickade på minst en länk under månaden. '
        + 'Meta redovisar bara totalt antal länkklick — inte hur många unika personer som klickade. '
        + 'Appen uppskattar detta utifrån kontoräckvidden. Visas som ett spann. '
        + 'Kräver att kontoräckvidd är importerad för samma månad och att kontot har minst 5 inlägg.',
    source: 'Beräknad (post-CSV + API-räckvidd)',
    summable: 'Nej — uppskattning per konto',
  },
];

const IG_METRICS = [
  { name: 'Visningar', key: 'views', desc: 'Hur många gånger inlägget visats. Samma person kan räknas flera gånger om de sett det vid olika tillfällen.', source: 'CSV: "Visningar"', summable: 'Ja' },
  { name: 'Räckvidd', key: 'reach', desc: 'Hur många unika konton som sett inlägget. Varje konto räknas bara en gång.', source: 'CSV: "Räckvidd"', summable: 'Nej' },
  { name: 'Gilla-markeringar', key: 'likes', desc: 'Hur många gånger inlägget fått en gilla-markering.', source: 'CSV: "Gilla-markeringar"', summable: 'Ja' },
  { name: 'Kommentarer', key: 'comments', desc: 'Hur många kommentarer inlägget fått.', source: 'CSV: "Kommentarer"', summable: 'Ja' },
  { name: 'Delningar', key: 'shares', desc: 'Hur många gånger inlägget delats vidare.', source: 'CSV: "Delningar"', summable: 'Ja' },
  { name: 'Sparade', key: 'saves', desc: 'Hur många gånger någon sparat inlägget för att titta på det senare.', source: 'CSV: "Sparade objekt"', summable: 'Ja' },
  { name: 'Följer', key: 'follows', desc: 'Hur många nya följare kontot fick som direkt följd av detta inlägg.', source: 'CSV: "Följer"', summable: 'Ja' },
  { name: 'Interaktioner', key: 'interactions', desc: 'Summan av gilla-markeringar, kommentarer och delningar.', source: 'Beräknad', summable: 'Ja' },
  { name: 'Engagemang', key: 'engagement', desc: 'Summan av gilla-markeringar, kommentarer, delningar, sparade och nya följare. Fångar all aktivitet på inlägget.', source: 'Beräknad', summable: 'Ja' },
];

const GA_METRICS = [
  { name: 'Lyssningar', key: 'listens', desc: 'Hur många gånger ett program lyssnats på under en månad, enligt Google Analytics.', source: 'GA CSV-export', summable: 'Ja' },
];

const AboutView = () => (
  <div className="space-y-6">
    <h2 className="text-xl font-semibold">Om appen</h2>

    {/* Section 1: Metrics Reference */}
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-lg font-semibold mb-4">Mätpunkter</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Här förklaras alla siffror som appen visar — vad de betyder, var de kommer ifrån, och vilka som kan jämföras och läggas ihop.
        </p>

        <MetricTable caption="Facebook-mätpunkter" rows={FB_METRICS} />
        <MetricTable caption="Instagram-mätpunkter" rows={IG_METRICS} />
        <MetricTable caption="Google Analytics (GA-lyssningar)" rows={GA_METRICS} />

        <div className="p-3 bg-muted/50 border border-border rounded-md text-sm text-muted-foreground">
          <strong>Notering:</strong> Lyssningsdata från Google Analytics finns bara per hel månad.
          Om du väljer ett datumintervall som inte är hela månader påverkas inte lyssningssiffrorna.
        </div>
      </CardContent>
    </Card>

    {/* Section 2: How the app handles data */}
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-lg font-semibold mb-4">Hur appen hanterar data</h3>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h4 className="text-base font-semibold mb-2">Dubbletter i exportfiler</h4>
            <p className="text-muted-foreground">
              Metas exportfiler kan innehålla samma inlägg på flera rader — ibland med olika siffror.
              Det beror på att Meta uppdaterar statistiken löpande, och olika versioner av samma
              inlägg kan hamna i samma export. Appen hittar dessa dubbletter automatiskt och
              behåller versionen med de högsta interaktionssiffrorna. Det gör att samma fil
              alltid ger samma resultat i appen.
            </p>
            <p className="text-muted-foreground mt-2">
              Antalet borttagna dubbletter visas i importsammanfattningen.
            </p>
          </section>

          <section>
            <h4 className="text-base font-semibold mb-2">Svenska och engelska kolumner</h4>
            <p className="text-muted-foreground">
              Metas exportfiler innehåller ibland statistikkolumner med rubriker på både svenska
              och engelska. Det händer att den svenska kolumnen är tom medan den engelska har ett
              värde. Appen använder alltid den svenska siffran i första hand, men fyller automatiskt
              i med den engelska om den svenska saknas. Det kan göra att appens totalsiffra är
              något högre än om man summerar bara de svenska kolumnerna i exportfilen för hand.
            </p>
          </section>

          <section>
            <h4 className="text-base font-semibold mb-2">Vad händer om man importerar samma data igen?</h4>
            <p className="text-muted-foreground">
              Om man laddar in en fil som innehåller inlägg som redan finns i appen uppdateras
              befintliga siffror med de nya värdena. Inlägg som importerades tidigare men inte
              finns med i den nya filen behålls som de är. Appen samlar alltså på sig en så
              komplett bild som möjligt av allt som importerats — det senaste värdet gäller
              för inlägg som uppdaterats.
            </p>
          </section>

          <section>
            <h4 className="text-base font-semibold mb-2">Vilka siffror kan läggas ihop?</h4>
            <p className="text-muted-foreground">
              Siffror som visningar, reaktioner, kommentarer och klick kan läggas ihop mellan
              konton — 1 000 visningar på ett konto plus 2 000 på ett annat är verkligen
              3 000 visningar totalt.
            </p>
            <p className="text-muted-foreground mt-2">
              Räckvidd fungerar annorlunda. En person som följer tre konton räknas i räckvidden
              för vart och ett av dem, men det är ändå bara en person. Att lägga ihop
              räckviddssiffrorna ger därför en överskattning. Appen visar genomsnitt istället
              för summa när räckvidd från flera konton visas tillsammans.
            </p>
            <p className="text-muted-foreground mt-2">
              Kontoräckvidd — den månatliga siffran som hämtas separat från Meta — kan inte
              jämföras direkt med räckvidden per inlägg, eftersom de kommer från olika datakällor.
            </p>
          </section>

          <section>
            <h4 className="text-base font-semibold mb-2">Uppskattade unika länkklickare</h4>
            <p className="text-muted-foreground">
              Meta redovisar länkklick som totalt antal — man kan inte se hur många unika
              personer som faktiskt klickade. Appen uppskattar antalet unika klickare genom
              att titta på hur många gånger en genomsnittlig följare räknas i inläggsstatistiken
              jämfört med i den månatliga kontoräckvidden. Om en person har sett tre inlägg
              räknas hen tre gånger i inläggsstatistiken men bara en gång i kontoräckvidden.
              Den kvoten visar hur stor "uppräkning" som skett.
            </p>
            <p className="text-muted-foreground mt-2">
              Uppskattningen visas som ett intervall. Det övre värdet antar att de som klickar
              beter sig som genomsnittspersonen i publiken. Det undre värdet justerar för att
              den som klickar på en länk troligen är en mer aktiv följare som ser fler inlägg.
              Det verkliga antalet unika klickare ligger sannolikt i eller strax under detta spann.
            </p>
            <p className="text-muted-foreground mt-2">
              <strong>Visningsregler:</strong> Uppskattningen visas inte om den månatliga
              kontoräckvidden saknas, om kontot publicerat färre än 5 inlägg under månaden,
              eller om siffrorna inte är logiskt sammanhängande. Konton med mycket hög andel
              återkommande läsare — de som ser nästan alla inlägg — visas med en varningssymbol,
              eftersom uppskattningen är mer osäker för sådana konton.
            </p>
          </section>

          <section>
            <h4 className="text-base font-semibold mb-2">Samarbetsinlägg</h4>
            <p className="text-muted-foreground">
              När två konton publicerar samma inlägg tillsammans märker appen upp detta
              automatiskt. Inlägget räknas bara en gång i statistiken, oavsett att det syns
              på båda kontona. Det förhindrar att siffrorna räknas dubbelt.
            </p>
          </section>
        </div>
      </CardContent>
    </Card>
  </div>
);

export default AboutView;
