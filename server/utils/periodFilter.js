/**
 * Build SQL WHERE conditions for period filtering.
 * Returns { conditions: string[], params: any[] } to append to existing WHERE.
 *
 * Supports two modes:
 * 1. dateFrom/dateTo — exact date range (takes precedence)
 * 2. months — comma-separated list of YYYY-MM strings
 *
 * If neither is provided, returns empty (no filtering).
 */
export function buildPeriodConditions(query) {
  const conditions = [];
  const params = [];

  const { dateFrom, dateTo, months } = query;

  if (dateFrom && dateTo) {
    // Exact date range. Use >= dateFrom and < dateTo+1 day to include all of dateTo.
    // The frontend sends dateTo as the last day to include (e.g. 2026-02-28).
    // We compare as strings — publish_time is stored as 'YYYY-MM-DD HH:MM:SS'.
    conditions.push("publish_time >= ?");
    params.push(`${dateFrom} 00:00:00`);
    conditions.push("publish_time <= ?");
    params.push(`${dateTo} 23:59:59`);
  } else if (dateFrom) {
    conditions.push("publish_time >= ?");
    params.push(`${dateFrom} 00:00:00`);
  } else if (dateTo) {
    conditions.push("publish_time <= ?");
    params.push(`${dateTo} 23:59:59`);
  } else if (months) {
    // months is a comma-separated string: "2026-01,2026-02"
    const monthList = months.split(',').map(m => m.trim()).filter(Boolean);
    if (monthList.length > 0) {
      const placeholders = monthList.map(() => '?').join(',');
      conditions.push(`strftime('%Y-%m', publish_time) IN (${placeholders})`);
      params.push(...monthList);
    }
  }

  return { conditions, params };
}
