/**
 * viewersImporter — import and query FB account-level unique viewers.
 * "Unika tittare (API)" = page_total_media_view_unique (Graph API v25.0+),
 * the replacement for deprecated legacy reach (page_impressions_unique).
 *
 * The new CSVs share headers (Page, Page ID, Reach) with legacy reach exports —
 * the Views_Source column is the only reliable discriminator, so detection and
 * validation are built around it. Values land in account_viewers, never in
 * account_reach (frozen legacy history).
 */
import Papa from 'papaparse';
import { getDb } from '../db/connection.js';

const EXPECTED_METRIC_PREFIX = 'page_total_media_view_unique@';

/**
 * Detect if a CSV is an FB viewers export: legacy-reach-style headers PLUS
 * the Views_Source column that only fetch_viewers.py writes.
 */
export function isViewersCSV(headers) {
  if (!headers || !Array.isArray(headers)) return false;
  const headerSet = new Set(headers.map(h => h.trim()));
  return headerSet.has('Page') && headerSet.has('Page ID') &&
         headerSet.has('Reach') && headerSet.has('Views_Source');
}

function isPlaceholderAccount(name) {
  if (!name) return true;
  return /^srholder/i.test(name.trim());
}

/**
 * Parse and import an FB viewers CSV. Month is auto-detected from Period_start.
 * Rejects files whose Views_Source is not page_total_media_view_unique@* so a
 * future metric change fails loudly instead of silently mixing measures.
 *
 * Returns { imported, skipped, month, accounts[] }
 */
export function importViewersCSV(csvContent, filename) {
  const result = Papa.parse(csvContent, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (!result.data || result.data.length === 0) {
    throw new Error('Ingen data hittades i CSV-filen.');
  }

  const headers = Object.keys(result.data[0]);
  if (!isViewersCSV(headers)) {
    throw new Error(
      'Filen är inte en Unika tittare-export. Förväntade kolumnerna Page, Page ID, Reach och Views_Source.'
    );
  }

  // Validate metric provenance on all rows that carry a source
  for (const row of result.data) {
    const src = row['Views_Source'] ? String(row['Views_Source']).trim() : '';
    if (src && !src.startsWith(EXPECTED_METRIC_PREFIX)) {
      throw new Error(
        `Okänt mått i Views_Source: "${src}". Förväntade ${EXPECTED_METRIC_PREFIX}… — importen avbröts för att inte blanda mått.`
      );
    }
  }

  // Auto-detect month from Period_start; all rows must share the same month
  const firstPeriodStart = result.data.find(r => r['Period_start'])?.['Period_start'];
  if (!firstPeriodStart) {
    throw new Error('Period_start saknas i CSV-filen.');
  }
  const monthMatch = String(firstPeriodStart).match(/(\d{4})-(\d{2})/);
  if (!monthMatch) {
    throw new Error(`Kunde inte tolka månaden från Period_start: ${firstPeriodStart}`);
  }
  const month = `${monthMatch[1]}-${monthMatch[2]}`;

  for (const row of result.data) {
    if (!row['Period_start']) continue;
    const m = String(row['Period_start']).match(/(\d{4})-(\d{2})/);
    if (m && `${m[1]}-${m[2]}` !== month) {
      throw new Error(`CSV-filen innehåller data för flera månader: ${month} och ${m[1]}-${m[2]}.`);
    }
  }

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO account_viewers (account_name, page_id, month, viewers, period_start, period_end, views_source, source_filename)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_name, month) DO UPDATE SET
      page_id = excluded.page_id,
      viewers = excluded.viewers,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      views_source = excluded.views_source,
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
      const viewers = parseInt(row['Reach'], 10) || 0;
      const status = row['Status'] ? String(row['Status']).trim() : '';
      const periodStart = row['Period_start'] ? String(row['Period_start']).trim() : null;
      const periodEnd = row['Period_end'] ? String(row['Period_end']).trim() : null;
      const viewsSource = row['Views_Source'] ? String(row['Views_Source']).trim() : null;

      if (!pageName || isPlaceholderAccount(pageName)) {
        skipped++;
        continue;
      }
      if (status === 'NO_DATA' || status === 'SKIPPED') {
        skipped++;
        continue;
      }

      upsert.run(pageName, pageId, month, viewers, periodStart, periodEnd, viewsSource, filename || null);
      imported++;
      accounts.push({ name: pageName, viewers });
    }
  })();

  return { imported, skipped, month, accounts };
}

/**
 * Get all months that have account_viewers data.
 */
export function getViewersMonths() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT month FROM account_viewers ORDER BY month ASC
  `).all().map(r => r.month);
}

/**
 * Delete all viewers data for a specific month.
 */
export function deleteViewersMonth(month) {
  const db = getDb();
  return db.prepare('DELETE FROM account_viewers WHERE month = ?').run(month);
}
