/**
 * Account names are always stored in Unicode NFC. Meta Business Suite's
 * Instagram exports deliver NFD (e.g. "a" + U+0308), while Facebook and GA
 * deliver NFC — visually identical but unequal in SQL/JS comparisons.
 * Use this at every boundary that writes or looks up an account name.
 * @param {*} name
 * @returns {*} NFC string; non-strings (null/undefined/numbers) pass through.
 */
export function nfc(name) {
  return typeof name === 'string' ? name.normalize('NFC') : name;
}
