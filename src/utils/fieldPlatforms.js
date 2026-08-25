/**
 * fieldPlatforms — vilka datapunkter som bara finns på en plattform.
 *
 * En sanningskälla för både fältväljaren (MainView) och kontofiltreringen
 * (AccountView), så listorna inte kan driva isär.
 */

export const FB_ONLY_FIELDS = [
  'total_clicks', 'link_clicks', 'other_clicks',
  'account_reach', 'account_viewers', 'estimated_unique_clicks',
];

// Fält som BARA finns på Instagram. 'saves' hör INTE hit — det finns i fler
// exporter, så saves får aldrig ensamt peka ut Instagram.
export const IG_ONLY_FIELDS = ['follows', 'ig_account_reach'];

// Fält som saknas i Facebook-exporterna (finns på Instagram).
// Används för att dölja fält under Facebook-chipet och för N/A-celler på FB-rader.
export const NON_FB_FIELDS = ['saves', ...IG_ONLY_FIELDS];

/**
 * Härled vilken plattform ett urval av datapunkter hör hemma på.
 *
 * Väljer man ett FB-mått vill man se FB-konton — annars fylls tabellen med
 * IG-rader som bara har tomma celler för just det måttet.
 *
 * Returnerar 'facebook' eller 'instagram' när urvalet entydigt pekar åt ett håll,
 * annars null (blandat urval, eller bara plattformsneutrala mått → visa allt).
 *
 * @param {string[]} selectedFields
 * @returns {'facebook'|'instagram'|null}
 */
export function platformFromFields(selectedFields) {
  if (!Array.isArray(selectedFields) || selectedFields.length === 0) return null;
  const hasFbOnly = selectedFields.some(f => FB_ONLY_FIELDS.includes(f));
  const hasIgOnly = selectedFields.some(f => IG_ONLY_FIELDS.includes(f));
  if (hasFbOnly && !hasIgOnly) return 'facebook';
  if (hasIgOnly && !hasFbOnly) return 'instagram';
  return null;
}
