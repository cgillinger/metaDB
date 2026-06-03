/**
 * gaListensImporter — import and query GA listening data.
 * Handles detection, parsing, and upsert of monthly programme listen counts
 * exported from Google Analytics.
 */
import Papa from 'papaparse';
import { getDb } from '../db/connection.js';

/**
 * Find the listens column in a list of headers.
 * Matches either the legacy "lyssningar" substring OR the new
 * "starter" + "lyssnat" combination (from "Starter (lyssnat5sek)").
 */
function findListensColumn(headers) {
  return headers.find(h => {
    const lower = h.trim().toLowerCase();
    return lower.includes('lyssningar')
        || lower.includes('lyssnat')
        || lower.startsWith('starter');
  }) || null;
}

/**
 * Detect if a CSV is a GA listens export.
 * Returns true if headers contain "Programnamn" and at least one column
 * whose name includes "lyssningar" (case-insensitive).
 */
export function isGaListensCSV(headers) {
  if (!headers || !Array.isArray(headers)) return false;
  const trimmed = headers.map(h => h.trim());
  return trimmed.includes('Programnamn') && findListensColumn(trimmed) !== null;
}

/**
 * Parse and import a GA listens CSV.
 * The CSV has no date information — the month must be provided by the user.
 *
 * Returns { imported, skipped, month, accounts[] }
 */
export function importGaListensCSV(csvContent, month, filename) {
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
  if (!isGaListensCSV(headers)) {
    throw new Error(
      'Filen är inte en GA-lyssnarexport. Förväntade kolumnen "Programnamn" och en kolumn för lyssningar (t.ex. "Starter (lyssnat5sek)" eller "...lyssningar...").'
    );
  }

  const listensCol = findListensColumn(headers);

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO ga_listens (account_name, month, listens, source_filename)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_name, month) DO UPDATE SET
      listens = excluded.listens,
      source_filename = excluded.source_filename,
      imported_at = datetime('now')
  `);

  // Deduplicate by taking MAX listens per trimmed account name.
  // GA exports can contain multiple rows that collapse to the same name after
  // trimming (e.g. "P4 Gävleborg" = 13 433 and "P4 Gävleborg " = 42).
  // These are distinct GA entities, not a split of the same measurement,
  // so the largest value is the canonical channel total and the rest is noise.
  const aggregated = new Map(); // trimmedName → maxListens
  let skipped = 0;

  for (const row of result.data) {
    const programName = (row['Programnamn'] || '').trim();
    const listens = parseInt(row[listensCol], 10) || 0;

    if (!programName) {
      skipped++;
      continue;
    }

    const current = aggregated.get(programName) ?? 0;
    if (listens > current) aggregated.set(programName, listens);
  }

  let imported = 0;
  const accounts = [];

  db.transaction(() => {
    for (const [programName, listens] of aggregated) {
      upsert.run(programName, month, listens, filename || null);
      imported++;
      accounts.push({ name: programName, listens });
    }
  })();

  return { imported, skipped, month, accounts };
}

/**
 * Get all GA listens data, optionally filtered by months.
 * months: array of 'YYYY-MM' strings, or null/undefined for all.
 */
export function getGaListens(months) {
  const db = getDb();

  if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(', ');
    return db.prepare(`
      SELECT account_name, month, listens, source_filename, imported_at
      FROM ga_listens
      WHERE month IN (${placeholders})
      ORDER BY month ASC, account_name ASC
    `).all(...months);
  }

  return db.prepare(`
    SELECT account_name, month, listens, source_filename, imported_at
    FROM ga_listens
    ORDER BY month ASC, account_name ASC
  `).all();
}

/**
 * Get all months that have ga_listens data.
 */
export function getGaListensMonths() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT month FROM ga_listens ORDER BY month ASC
  `).all().map(r => r.month);
}

/**
 * Delete all GA listens data for a specific month.
 */
export function deleteGaListensMonth(month) {
  const db = getDb();
  return db.prepare('DELETE FROM ga_listens WHERE month = ?').run(month);
}

/**
 * Delete all GA listens data for one or more account names (across all months).
 * @param {string[]} accountNames - Array of programme names to delete
 * @returns {{ deleted: number }} - Number of rows removed
 */
export function deleteGaListensAccounts(accountNames) {
  if (!accountNames || accountNames.length === 0) return { deleted: 0 };
  const db = getDb();
  const placeholders = accountNames.map(() => '?').join(', ');
  const result = db.prepare(
    `DELETE FROM ga_listens WHERE account_name IN (${placeholders})`
  ).run(...accountNames);
  return { deleted: result.changes };
}

/**
 * Delete all GA listens data for a specific account within the given months.
 * months: array of 'YYYY-MM' strings (required, at least 1 element).
 * Returns the number of deleted rows.
 */
export function deleteGaListensByAccount(accountName, months) {
  const db = getDb();
  const placeholders = months.map(() => '?').join(', ');
  const result = db.prepare(
    `DELETE FROM ga_listens WHERE account_name = ? AND month IN (${placeholders})`
  ).run(accountName, ...months);
  return result.changes;
}
