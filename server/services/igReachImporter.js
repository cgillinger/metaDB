import Papa from 'papaparse';
import { getDb } from '../db/connection.js';

/**
 * Detect if a CSV is an IG account-level reach export.
 * Returns true if headers contain ig_username, ig_name, Reach, Period_start.
 */
export function isIGReachCSV(headers) {
  if (!headers || !Array.isArray(headers)) return false;
  const headerSet = new Set(headers.map(h => h.trim()));
  return headerSet.has('ig_username') &&
         headerSet.has('ig_name') &&
         headerSet.has('Reach') &&
         headerSet.has('Period_start');
}

function isPlaceholderAccount(name) {
  if (!name) return true;
  return /^srholder/i.test(name.trim());
}

/**
 * Parse and import an IG account-level reach CSV.
 * Month is auto-detected from Period_start — no manual month needed.
 *
 * Returns { imported, skipped, month, accounts[] }
 */
export function importIGReachCSV(csvContent, filename) {
  const result = Papa.parse(csvContent, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (!result.data || result.data.length === 0) {
    throw new Error('Ingen data hittades i CSV-filen.');
  }

  const headers = Object.keys(result.data[0]);
  if (!isIGReachCSV(headers)) {
    throw new Error('Filen är inte en IG-räckviddsexport. Förväntade kolumnerna ig_username, ig_name, Reach, Period_start.');
  }

  // Auto-detect month from first row's Period_start
  const firstPeriodStart = result.data[0]['Period_start'];
  if (!firstPeriodStart) {
    throw new Error('Period_start saknas i CSV-filen.');
  }

  const monthMatch = String(firstPeriodStart).match(/(\d{4})-(\d{2})/);
  if (!monthMatch) {
    throw new Error(`Kunde inte tolka månaden från Period_start: ${firstPeriodStart}`);
  }
  const month = `${monthMatch[1]}-${monthMatch[2]}`;

  // Validate all rows share the same month
  for (const row of result.data) {
    if (!row['Period_start']) continue;
    const m = String(row['Period_start']).match(/(\d{4})-(\d{2})/);
    if (m && `${m[1]}-${m[2]}` !== month) {
      throw new Error(`CSV-filen innehåller data för flera månader. Förväntade ${month}, hittade ${m[1]}-${m[2]}.`);
    }
  }

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO ig_account_reach (account_name, ig_username, month, reach, followers, source_filename)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_name, month) DO UPDATE SET
      ig_username = excluded.ig_username,
      reach = excluded.reach,
      followers = excluded.followers,
      source_filename = excluded.source_filename,
      imported_at = datetime('now')
  `);

  let imported = 0;
  let skipped = 0;
  const accounts = [];

  db.transaction(() => {
    for (const row of result.data) {
      const igName = row['ig_name'] ? String(row['ig_name']).trim() : '';
      const igUsername = row['ig_username'] ? String(row['ig_username']).trim() : null;
      const reach = parseInt(row['Reach'], 10) || 0;
      const followers = parseInt(row['Followers'], 10) || 0;
      const status = row['Status'] ? String(row['Status']).trim() : '';

      // Skip if ig_name is missing or is a placeholder
      if (!igName || isPlaceholderAccount(igName)) {
        skipped++;
        continue;
      }

      // Skip NO_DATA rows
      if (status === 'NO_DATA') {
        skipped++;
        continue;
      }

      upsert.run(igName, igUsername, month, reach, followers, filename || null);
      imported++;
      accounts.push({ name: igName, username: igUsername, reach });
    }
  })();

  return { imported, skipped, month, accounts };
}

export function getIGReachMonths() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT month FROM ig_account_reach ORDER BY month ASC
  `).all().map(r => r.month);
}

export function getIGReachAccounts() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT account_name, ig_username FROM ig_account_reach ORDER BY account_name ASC
  `).all();
}

export function deleteIGReachMonth(month) {
  const db = getDb();
  return db.prepare('DELETE FROM ig_account_reach WHERE month = ?').run(month);
}
