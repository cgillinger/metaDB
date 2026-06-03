/**
 * gaSiteVisitsImporter — import and query GA site visit data.
 * Handles detection, parsing, and upsert of monthly programme visit counts
 * exported from Google Analytics.
 */
import Papa from 'papaparse';
import { getDb } from '../db/connection.js';

/**
 * Find the "besök" column in a list of headers (case-insensitive substring match).
 * Returns the matching header name, or null if not found.
 */
function findVisitsColumn(headers) {
  return headers.find(h => h.trim().toLowerCase().includes('besök')) || null;
}

/**
 * Detect if a CSV is a GA site visits export.
 * Returns true if headers contain "Programnamn" and at least one column
 * whose name includes "besök" (case-insensitive).
 */
export function isGaSiteVisitsCSV(headers) {
  if (!headers || !Array.isArray(headers)) return false;
  const trimmed = headers.map(h => h.trim());
  return trimmed.includes('Programnamn') && findVisitsColumn(trimmed) !== null;
}

/**
 * Parse and import a GA site visits CSV.
 * The CSV has no date information — the month must be provided by the user.
 *
 * Returns { imported, skipped, month, accounts[] }
 */
export function importGaSiteVisitsCSV(csvContent, month, filename) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('Månad måste anges i formatet YYYY-MM.');
  }

  const result = Papa.parse(csvContent, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (!result.data || result.data.length === 0) {
    throw new Error('Ingen data hittades i CSV-filen.');
  }

  const headers = Object.keys(result.data[0]).map(h => h.trim());
  if (!isGaSiteVisitsCSV(headers)) {
    throw new Error(
      'Filen är inte en GA-sajtbesökexport. Förväntade kolumnen \'Programnamn\' och en kolumn \'Besök\'.'
    );
  }

  const visitsCol = findVisitsColumn(headers);

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO ga_site_visits (account_name, month, visits, source_filename)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_name, month) DO UPDATE SET
      visits = excluded.visits,
      source_filename = excluded.source_filename,
      imported_at = datetime('now')
  `);

  // Deduplicate by taking MAX visits per trimmed account name.
  const aggregated = new Map(); // trimmedName → maxVisits
  let skipped = 0;

  for (const row of result.data) {
    const programName = (row['Programnamn'] || '').trim();
    const visits = parseInt(row[visitsCol], 10) || 0;

    if (!programName) {
      skipped++;
      continue;
    }

    const current = aggregated.get(programName) ?? 0;
    if (visits > current) aggregated.set(programName, visits);
  }

  let imported = 0;
  const accounts = [];

  db.transaction(() => {
    for (const [programName, visits] of aggregated) {
      upsert.run(programName, month, visits, filename || null);
      imported++;
      accounts.push({ name: programName, visits });
    }
  })();

  return { imported, skipped, month, accounts };
}

/**
 * Get all GA site visits data, optionally filtered by months.
 * months: array of 'YYYY-MM' strings, or null/undefined for all.
 */
export function getGaSiteVisits(months) {
  const db = getDb();

  if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(', ');
    return db.prepare(`
      SELECT account_name, month, visits, source_filename, imported_at
      FROM ga_site_visits
      WHERE month IN (${placeholders})
      ORDER BY month ASC, account_name ASC
    `).all(...months);
  }

  return db.prepare(`
    SELECT account_name, month, visits, source_filename, imported_at
    FROM ga_site_visits
    ORDER BY month ASC, account_name ASC
  `).all();
}

/**
 * Get all months that have ga_site_visits data.
 */
export function getGaSiteVisitsMonths() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT month FROM ga_site_visits ORDER BY month ASC
  `).all().map(r => r.month);
}

/**
 * Delete all GA site visits data for a specific month.
 */
export function deleteGaSiteVisitsMonth(month) {
  const db = getDb();
  return db.prepare('DELETE FROM ga_site_visits WHERE month = ?').run(month);
}

/**
 * Delete all GA site visits data for a specific account within the given months.
 * months: array of 'YYYY-MM' strings (required, at least 1 element).
 * Returns the number of deleted rows.
 */
export function deleteGaSiteVisitsByAccount(accountName, months) {
  const db = getDb();
  const placeholders = months.map(() => '?').join(', ');
  const result = db.prepare(
    `DELETE FROM ga_site_visits WHERE account_name = ? AND month IN (${placeholders})`
  ).run(accountName, ...months);
  return result.changes;
}

/**
 * Delete all GA site visits data for one or more account names (across all months).
 * @param {string[]} accountNames - Array of programme names to delete
 * @returns {{ deleted: number }} - Number of rows removed
 */
export function deleteGaSiteVisitsAccounts(accountNames) {
  if (!accountNames || accountNames.length === 0) return { deleted: 0 };
  const db = getDb();
  const placeholders = accountNames.map(() => '?').join(', ');
  const result = db.prepare(
    `DELETE FROM ga_site_visits WHERE account_name IN (${placeholders})`
  ).run(...accountNames);
  return { deleted: result.changes };
}
