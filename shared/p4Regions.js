/**
 * The 25 active P4 local radio stations in Sweden.
 * Used for the "P4 Lokalt" filter in Plattformstrend.
 * Match pattern: account_name starts with "P4 " + region name.
 *
 * Excludes: P4 DANS, P4 Dokumentär, P4 Extra, P4 Plus, P4 Södertälje (nedlagd).
 */
export const P4_REGIONS = [
  'Blekinge', 'Dalarna', 'Gotland', 'Gävleborg', 'Göteborg',
  'Halland', 'Jämtland', 'Jönköping', 'Kalmar', 'Kristianstad',
  'Kronoberg', 'Malmöhus', 'Norrbotten', 'Sjuhärad', 'Skaraborg',
  'Stockholm', 'Sörmland', 'Uppland', 'Värmland', 'Väst',
  'Västerbotten', 'Västernorrland', 'Västmanland', 'Örebro', 'Östergötland'
];

/**
 * True if a Meta account name is one of the 25 active P4 local stations.
 * Canonical matcher — mirrors the backend SQL filter (account_name LIKE
 * 'P4 {region}%', which is case-insensitive in SQLite). Use this everywhere
 * instead of re-implementing the startsWith check per call site.
 * @param {string} accountName
 * @returns {boolean}
 */
export function isP4LocalStation(accountName) {
  const name = (accountName || '').toLowerCase();
  return P4_REGIONS.some(region => name.startsWith(`p4 ${region.toLowerCase()}`));
}
