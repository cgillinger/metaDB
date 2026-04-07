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
  { name: 'Visningar', key: 'views', desc: 'Antal gånger inlägget visats (inklusive upprepade visningar av samma person).', source: 'CSV: "Visningar"', summable: 'Ja' },
  { name: 'Räckvidd', key: 'reach', desc: 'Uppskattat antal unika personer som sett inlägget.', source: 'CSV: "Räckvidd"', summable: 'Nej — genomsnitt vid aggregering' },
  { name: 'Reaktioner', key: 'likes', desc: 'Antal reaktioner (gilla, hjärta, haha, arg, etc.).', source: 'CSV: "Reaktioner"', summable: 'Ja' },
  { name: 'Kommentarer', key: 'comments', desc: 'Antal kommentarer på inlägget.', source: 'CSV: "Kommentarer"', summable: 'Ja' },
  { name: 'Delningar', key: 'shares', desc: 'Antal gånger inlägget delats.', source: 'CSV: "Delningar"', summable: 'Ja' },
  { name: 'Interaktioner', key: 'interactions', desc: 'Reaktioner + kommentarer + delningar. Beräknas alltid från delvärdena, inte från Metas sammansatta kolumn.', source: 'Beräknad', summable: 'Ja' },
  { name: 'Engagemang', key: 'engagement', desc: 'Interaktioner + totalt antal klick. Bredare mått som inkluderar alla typer av användaraktivitet.', source: 'Beräknad', summable: 'Ja' },
  { name: 'Totalt antal klick', key: 'total_clicks', desc: 'Alla klick på inlägget (länkklick + övriga klick).', source: 'CSV: "Totalt antal klick"', summable: 'Ja' },
  { name: 'Länkklick', key: 'link_clicks', desc: 'Klick på länkar i inlägget.', source: 'CSV: "Länkklick"', summable: 'Ja' },
  { name: 'Övriga klick', key: 'other_clicks', desc: 'Klick som inte är länkklick (t.ex. klick för att expandera bild).', source: 'CSV: "Övriga klick"', summable: 'Ja' },
  { name: 'Kontoräckvidd', key: 'account_reach', desc: 'Månatlig räckvidd per konto. Separat datakälla (Graph API), inte från post-CSV.', source: 'API-export', summable: 'Nej — kan inte summeras meningsfullt' },
];

const IG_METRICS = [
  { name: 'Visningar', key: 'views', desc: 'Antal gånger inlägget visats.', source: 'CSV: "Visningar"', summable: 'Ja' },
  { name: 'Räckvidd', key: 'reach', desc: 'Uppskattat antal unika konton som sett inlägget.', source: 'CSV: "Räckvidd"', summable: 'Nej' },
  { name: 'Gilla-markeringar', key: 'likes', desc: 'Antal gilla-markeringar.', source: 'CSV: "Gilla-markeringar"', summable: 'Ja' },
  { name: 'Kommentarer', key: 'comments', desc: 'Antal kommentarer.', source: 'CSV: "Kommentarer"', summable: 'Ja' },
  { name: 'Delningar', key: 'shares', desc: 'Antal gånger inlägget delats.', source: 'CSV: "Delningar"', summable: 'Ja' },
  { name: 'Sparade', key: 'saves', desc: 'Antal gånger inlägget sparats.', source: 'CSV: "Sparade objekt"', summable: 'Ja' },
  { name: 'Följer', key: 'follows', desc: 'Antal nya följare från inlägget.', source: 'CSV: "Följer"', summable: 'Ja' },
  { name: 'Interaktioner', key: 'interactions', desc: 'Gilla + kommentarer + delningar.', source: 'Beräknad', summable: 'Ja' },
  { name: 'Engagemang', key: 'engagement', desc: 'Gilla + kommentarer + delningar + sparade + följer. Bredare mått anpassat för Instagram.', source: 'Beräknad', summable: 'Ja' },
];

const GA_METRICS = [
  { name: 'Lyssningar', key: 'listens', desc: 'Antal lyssningar per program och månad.', source: 'GA CSV-export', summable: 'Ja' },
];

const AboutView = () => (
  <div className="space-y-6">
    <h2 className="text-xl font-semibold">Om appen</h2>

    {/* Section 1: Metrics Reference */}
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-lg font-semibold mb-4">Mätpunkter</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Referens över alla mätpunkter som appen visar, grupperade per plattform.
        </p>

        <MetricTable caption="Facebook-mätpunkter" rows={FB_METRICS} />
        <MetricTable caption="Instagram-mätpunkter" rows={IG_METRICS} />
        <MetricTable caption="Google Analytics (GA-lyssningar)" rows={GA_METRICS} />

        <div className="p-3 bg-muted/50 border border-border rounded-md text-sm text-muted-foreground">
          <strong>Notering:</strong> GA-lyssningsdata har ingen datumgranularitet — det är alltid hela månader.
          Anpassade datumintervall har ingen effekt på GA-data.
        </div>
      </CardContent>
    </Card>

    {/* Section 2: How the app handles data */}
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-lg font-semibold mb-4">Hur appen hanterar data</h3>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h4 className="text-base font-semibold mb-2">Deduplicering</h4>
            <p className="text-muted-foreground">
              Meta Business Suites CSV-exporter kan innehålla dubletter — samma inläggs-id
              förekommer på flera rader, ibland med olika värden. Appen hanterar detta genom
              att behålla den rad som har högst interaktionsvärde per inläggs-id. Detta ger
              ett deterministiskt resultat: samma CSV-fil ger alltid samma total oavsett radordning.
            </p>
            <p className="text-muted-foreground mt-2">
              Antalet borttagna dubbletter visas i importsammanfattningen.
            </p>
          </section>

          <section>
            <h4 className="text-base font-semibold mb-2">Kolumn-fallback (svenska/engelska)</h4>
            <p className="text-muted-foreground">
              Vissa Meta-exporter innehåller kolumner på både svenska och engelska. Om den svenska
              kolumnen saknar data men den engelska har ett värde, används det engelska värdet.
              Detta innebär att appens total ibland kan vara högre än om man bara summerar de
              svenska kolumnerna manuellt i CSV-filen.
            </p>
          </section>

          <section>
            <h4 className="text-base font-semibold mb-2">Upsert vid reimport</h4>
            <p className="text-muted-foreground">
              När samma data importeras igen uppdateras befintliga poster baserat på inläggs-id.
              Poster som fanns i en tidigare import men saknas i den nya filen behålls — databasen
              reflekterar alltså den mest kompletta bilden av all importerad data, inte nödvändigtvis
              en enskild CSV-export.
            </p>
          </section>

          <section>
            <h4 className="text-base font-semibold mb-2">Summerbara och icke-summerbara mätpunkter</h4>
            <p className="text-muted-foreground">
              Mätpunkter som visningar, interaktioner och klick kan summeras meningsfullt över
              flera konton. Räckvidd (reach) kan <strong>inte</strong> summeras — en person som
              följer tre konton räknas i alla tre kontons räckvidd men är fortfarande en unik person.
              Appen visar genomsnitt istället för summa för räckviddsmått vid aggregering.
            </p>
            <p className="text-muted-foreground mt-2">
              Kontoräckvidd (account_reach) från Graph API är en helt separat datakälla med egen
              import och kan inte jämföras direkt med postbaserad räckvidd.
            </p>
          </section>

          <section>
            <h4 className="text-base font-semibold mb-2">Samarbetsinlägg (collabs)</h4>
            <p className="text-muted-foreground">
              Inlägg som publicerats som samarbete mellan flera konton detekteras automatiskt och
              flaggas. Detta förhindrar dubbelräkning vid aggregering — ett samarbetsinlägg räknas
              bara en gång, inte en gång per deltagande konto.
            </p>
          </section>
        </div>
      </CardContent>
    </Card>
  </div>
);

export default AboutView;
