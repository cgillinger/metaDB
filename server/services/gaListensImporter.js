/**
 * gaListensImporter — import and query GA listening data.
 * Handles detection, parsing, and upsert of monthly programme listen counts
 * exported from Google Analytics.
 */
import Papa from 'papaparse';
import { getDb } from '../db/connection.js';

/**
 * Find the "lyssningar" column in a list of headers (case-insensitive substring match).
 * Returns the matching header name, or null if not found.
 */
function findListensColumn(headers) {
  return headers.find(h => h.trim().toLowerCase().includes('lyssningar')) || null;
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
      'Filen är inte en GA-lyssnarexport. Förväntade kolumnen "Programnamn" och en kolumn med "lyssningar".'
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

  // Accumulate listens per trimmed account name to handle duplicate/trailing-space
  // variants in the same CSV (e.g. "P4 Väst" and "P4 Väst " should be one row).
  const aggregated = new Map(); // trimmedName → totalListens
  let skipped = 0;

  for (const row of result.data) {
    const programName = (row['Programnamn'] || '').trim();
    const listens = parseInt(row[listensCol], 10) || 0;

    if (!programName) {
      skipped++;
      continue;
    }

    aggregated.set(programName, (aggregated.get(programName) || 0) + listens);
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
