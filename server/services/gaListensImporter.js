import Papa from 'papaparse';
import { getDb } from '../db/connection.js';

/**
 * Detect if a CSV is a GA listens export.
 * Returns true if headers contain "Program" and "Lyssningar".
 */
export function isGaListensCSV(headers) {
  if (!headers || !Array.isArray(headers)) return false;
  const headerSet = new Set(headers.map(h => h.trim()));
  return headerSet.has('Program') && headerSet.has('Lyssningar');
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

  const headers = Object.keys(result.data[0]);
  if (!isGaListensCSV(headers)) {
    throw new Error('Filen är inte en GA-lyssnarexport. Förväntade kolumnerna Program, Lyssningar.');
  }

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO ga_listens (account_name, month, listens, source_filename)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_name, month) DO UPDATE SET
      listens = excluded.listens,
      source_filename = excluded.source_filename,
      imported_at = datetime('now')
  `);

  let imported = 0;
  let skipped = 0;
  const accounts = [];

  db.transaction(() => {
    for (const row of result.data) {
      const programName = (row['Program'] || '').trim();
      const listens = parseInt(row['Lyssningar'], 10) || 0;

      if (!programName) {
        skipped++;
        continue;
      }

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
