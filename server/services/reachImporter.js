import Papa from 'papaparse';
import { getDb } from '../db/connection.js';

/**
 * Detect if a CSV is an API-level reach export.
 * Returns true if headers contain "Page", "Page ID", "Reach".
 */
export function isReachCSV(headers) {
  if (!headers || !Array.isArray(headers)) return false;
  const headerSet = new Set(headers.map(h => h.trim()));
  return headerSet.has('Page') && headerSet.has('Page ID') && headerSet.has('Reach');
}

/**
 * Check if an account name is a placeholder account that should be filtered out.
 */
function isPlaceholderAccount(name) {
  if (!name) return true;
  return /^srholder/i.test(name.trim());
}

/**
 * Parse and import an API-level reach CSV.
 * The CSV has no date information — the month must be provided by the user.
 *
 * Returns { imported, skipped, month, accounts[] }
 */
export function importReachCSV(csvContent, month, filename) {
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
  if (!isReachCSV(headers)) {
    throw new Error('Filen är inte en API-räckviddsexport. Förväntade kolumnerna Page, Page ID, Reach.');
  }

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO account_reach (account_name, page_id, month, reach, source_filename)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_name, month) DO UPDATE SET
      page_id = excluded.page_id,
      reach = excluded.reach,
      source_filename = excluded.source_filename,
      imported_at = datetime('now')
  `);

  let imported = 0;
  let skipped = 0;
  const accounts = [];

  db.transaction(() => {
    for (const row of result.data) {
      const pageName = (row['Page'] || '').trim();
      const pageId = row['Page ID'] ? String(row['Page ID']).trim() : null;
      const reach = parseInt(row['Reach'], 10) || 0;
      const status = (row['Status'] || '').trim();

      // Skip placeholder accounts
      if (isPlaceholderAccount(pageName)) {
        skipped++;
        continue;
      }

      // Skip NO_DATA rows
      if (status === 'NO_DATA') {
        skipped++;
        continue;
      }

      // Skip empty names
      if (!pageName) {
        skipped++;
        continue;
      }

      upsert.run(pageName, pageId, month, reach, filename || null);
      imported++;
      accounts.push({ name: pageName, reach });
    }
  })();

  return { imported, skipped, month, accounts };
}

/**
 * Get all months that have account_reach data.
 */
export function getReachMonths() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT month FROM account_reach ORDER BY month ASC
  `).all().map(r => r.month);
}

/**
 * Delete all reach data for a specific month.
 */
export function deleteReachMonth(month) {
  const db = getDb();
  return db.prepare('DELETE FROM account_reach WHERE month = ?').run(month);
}
