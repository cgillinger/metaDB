/**
 * gaAccountAliases — canonical names for GA accounts that changed name over time.
 *
 * GA exports label rows with the account's name at export time, so a renamed
 * account appears as two different accounts across CSV files. This map folds
 * known historical names into the current canonical name at import, keeping
 * each account as one continuous series in ga_listens / ga_site_visits.
 *
 * Keys and values are trimmed names (importers trim before lookup).
 */
const GA_ACCOUNT_ALIASES = new Map([
  // Ekot renamed: in site-visits exports from 2025-01, in listens exports from 2026-04.
  ['Nyheter (Ekot)', 'Ekot'],
  ['Nyheter från Sveriges Radio Ekot', 'Ekot'],
]);

/**
 * Return the canonical account name for a trimmed GA account name.
 * Names without a known alias are returned unchanged.
 */
export function canonicalGaAccountName(name) {
  return GA_ACCOUNT_ALIASES.get(name) ?? name;
}
