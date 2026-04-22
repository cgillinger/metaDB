import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { getDb } from '../db/connection.js';
import { parseCSV } from '../services/csvProcessor.js';
import { redetectAllCollabs } from '../services/collabDetector.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';
import { hiddenPostsFilter, hiddenGAFilter, hiddenSiteVisitsFilter } from '../services/hiddenAccounts.js';

const router = Router();

// Multer config: 50 MB cap, CSV-only filter
const upload = multer({
  dest: '/tmp/meta-uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Endast CSV-filer tillåtna.'));
    }
  },
});

// GET /api/imports — list all imports
router.get('/', (req, res) => {
  const db = getDb();
  const imports = db.prepare(`
    SELECT id, filename, platform, month, imported_at, row_count,
           account_count, date_range_start, date_range_end
    FROM imports
    ORDER BY imported_at DESC
  `).all();

  res.json(imports);
});

// GET /api/imports/coverage — which months have data
router.get('/coverage', (req, res) => {
  const db = getDb();

  // Get post counts per month from actual posts table
  const postRows = db.prepare(`
    SELECT
      strftime('%Y-%m', publish_time) AS month,
      COUNT(*) AS post_count,
      SUM(CASE WHEN platform = 'facebook' THEN 1 ELSE 0 END) AS fb_count,
      SUM(CASE WHEN platform = 'instagram' THEN 1 ELSE 0 END) AS ig_count
    FROM posts
    WHERE publish_time IS NOT NULL
    ${hiddenPostsFilter()} -- Hidden accounts filter
    GROUP BY strftime('%Y-%m', publish_time)
    ORDER BY month ASC
  `).all();

  // Get all months that have account_reach data
  let reachMonthSet = new Set();
  try {
    const reachRows = db.prepare(`
      SELECT DISTINCT month FROM account_reach ORDER BY month ASC
    `).all();
    for (const r of reachRows) reachMonthSet.add(r.month);
  } catch (e) {
    // account_reach table may not exist yet
  }

  // Get all months that have ig_account_reach data
  let igReachMonthSet = new Set();
  try {
    const igReachRows = db.prepare(`
      SELECT DISTINCT month FROM ig_account_reach ORDER BY month ASC
    `).all();
    for (const r of igReachRows) igReachMonthSet.add(r.month);
  } catch (e) {
    // ig_account_reach table may not exist yet
  }

  // Count distinct programmes with GA listens data per month.
  // Used by the frontend to filter the period selector by platform.
  let gaListensCountMap = new Map();
  try {
    const gaCountRows = db.prepare(`
      SELECT month, COUNT(DISTINCT account_name) AS ga_listens_count
      FROM ga_listens
      WHERE 1=1
      ${hiddenGAFilter()} -- Hidden accounts filter
      GROUP BY month
    `).all();
    for (const r of gaCountRows) gaListensCountMap.set(r.month, r.ga_listens_count);
  } catch (e) {
    // ga_listens table may not exist yet
  }

  // Count distinct accounts with GA site visits per month
  let gaSiteVisitsCountMap = new Map();
  try {
    const gsvCountRows = db.prepare(`
      SELECT month, COUNT(DISTINCT account_name) AS ga_site_visits_count
      FROM ga_site_visits
      WHERE 1=1
      ${hiddenSiteVisitsFilter()}
      GROUP BY month
    `).all();
    for (const r of gsvCountRows) gaSiteVisitsCountMap.set(r.month, r.ga_site_visits_count);
  } catch (e) {
    // ga_site_visits may not exist yet
  }

  const months = postRows.map(r => ({
    month: r.month,
    post_count: r.post_count,
    fb_count: r.fb_count,
    ig_count: r.ig_count,
    has_facebook: r.fb_count > 0,
    has_instagram: r.ig_count > 0,
    has_reach: reachMonthSet.has(r.month),
    has_ig_reach: igReachMonthSet.has(r.month),
    has_ga_listens: gaListensCountMap.has(r.month),
    ga_listens_count: gaListensCountMap.get(r.month) || 0,
    has_ga_site_visits: gaSiteVisitsCountMap.has(r.month),
    ga_site_visits_count: gaSiteVisitsCountMap.get(r.month) || 0,
  }));

  // Add reach-only months (no posts, but have account reach data)
  const postMonthSet = new Set(postRows.map(r => r.month));
  for (const reachMonth of reachMonthSet) {
    if (!postMonthSet.has(reachMonth)) {
      months.push({
        month: reachMonth,
        post_count: 0,
        fb_count: 0,
        ig_count: 0,
        has_facebook: true,
        has_instagram: false,
        has_reach: true,
        has_ig_reach: igReachMonthSet.has(reachMonth),
        has_ga_listens: gaListensCountMap.has(reachMonth),
        ga_listens_count: gaListensCountMap.get(reachMonth) || 0,
        has_ga_site_visits: gaSiteVisitsCountMap.has(reachMonth),
        ga_site_visits_count: gaSiteVisitsCountMap.get(reachMonth) || 0,
      });
    }
  }

  // Add IG reach-only months (no posts, no FB reach, but have IG reach data)
  const coveredByPostOrFBReach = new Set([...postMonthSet, ...reachMonthSet]);
  for (const igMonth of igReachMonthSet) {
    if (!coveredByPostOrFBReach.has(igMonth)) {
      months.push({
        month: igMonth,
        post_count: 0,
        fb_count: 0,
        ig_count: 0,
        has_facebook: false,
        has_instagram: true,
        has_reach: false,
        has_ig_reach: true,
        has_ga_listens: gaListensCountMap.has(igMonth),
        ga_listens_count: gaListensCountMap.get(igMonth) || 0,
        has_ga_site_visits: gaSiteVisitsCountMap.has(igMonth),
        ga_site_visits_count: gaSiteVisitsCountMap.get(igMonth) || 0,
      });
    }
  }

  // Add GA-only months (no posts, no FB reach, no IG reach, but have ga_listens data)
  const coveredByPostFBReachIGReach = new Set([...postMonthSet, ...reachMonthSet, ...igReachMonthSet]);
  for (const [gaMonth, gaCount] of gaListensCountMap) {
    if (!coveredByPostFBReachIGReach.has(gaMonth)) {
      months.push({
        month: gaMonth,
        post_count: 0,
        fb_count: 0,
        ig_count: 0,
        has_facebook: false,
        has_instagram: false,
        has_reach: false,
        has_ig_reach: false,
        has_ga_listens: true,
        ga_listens_count: gaCount,
        has_ga_site_visits: gaSiteVisitsCountMap.has(gaMonth),
        ga_site_visits_count: gaSiteVisitsCountMap.get(gaMonth) || 0,
      });
    }
  }

  // Add GSV-only months (no posts, no reach, no IG reach, no ga_listens)
  const coveredMonths = new Set([...postMonthSet, ...reachMonthSet, ...igReachMonthSet, ...gaListensCountMap.keys()]);
  for (const [gsvMonth, gsvCount] of gaSiteVisitsCountMap) {
    if (!coveredMonths.has(gsvMonth)) {
      months.push({
        month: gsvMonth,
        post_count: 0,
        fb_count: 0,
        ig_count: 0,
        has_facebook: false,
        has_instagram: false,
        has_reach: false,
        has_ig_reach: false,
        has_ga_listens: false,
        ga_listens_count: 0,
        has_ga_site_visits: true,
        ga_site_visits_count: gsvCount,
      });
    }
  }

  // Sort all months chronologically
  months.sort((a, b) => a.month.localeCompare(b.month));

  res.json({ months });
});

// POST /api/imports — upload and process a CSV file
// uploadLimiter: max 10 uploads per minute to prevent abuse
router.post('/', uploadLimiter, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil bifogades.' });
  }

  try {
    // Read the uploaded file
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    // Parse CSV
    const parsed = parseCSV(csvContent, req.file.originalname);

    const db = getDb();

    // Insert import record and posts in a transaction
    const result = db.transaction(() => {
      // Create import record
      const importResult = db.prepare(`
        INSERT INTO imports (filename, platform, month, row_count, account_count,
                             date_range_start, date_range_end)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.file.originalname,
        parsed.platform,
        parsed.month,
        parsed.stats.parsedPosts,
        parsed.stats.accountCount,
        parsed.dateRangeStart,
        parsed.dateRangeEnd
      );

      const importId = importResult.lastInsertRowid;

      // Prepare UPSERT statement
      const upsert = db.prepare(`
        INSERT INTO posts (
          import_id, post_id, account_id, account_name, account_username,
          description, publish_time, post_type, permalink, platform,
          views, reach, likes, comments, shares,
          total_clicks, link_clicks, other_clicks, saves, follows,
          interactions, engagement
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?
        )
        ON CONFLICT(post_id, platform) DO UPDATE SET
          import_id = excluded.import_id,
          account_id = excluded.account_id,
          account_name = excluded.account_name,
          account_username = excluded.account_username,
          description = excluded.description,
          publish_time = excluded.publish_time,
          post_type = excluded.post_type,
          permalink = excluded.permalink,
          views = excluded.views,
          reach = excluded.reach,
          likes = excluded.likes,
          comments = excluded.comments,
          shares = excluded.shares,
          total_clicks = excluded.total_clicks,
          link_clicks = excluded.link_clicks,
          other_clicks = excluded.other_clicks,
          saves = excluded.saves,
          follows = excluded.follows,
          interactions = excluded.interactions,
          engagement = excluded.engagement
      `);

      let inserted = 0;
      let updated = 0;

      const existsCheck = db.prepare(
        'SELECT 1 FROM posts WHERE post_id = ? AND platform = ?'
      );

      for (const post of parsed.posts) {
        if (!post.post_id) continue;

        const exists = existsCheck.get(post.post_id, post.platform);

        upsert.run(
          importId,
          post.post_id, post.account_id, post.account_name, post.account_username,
          post.description, post.publish_time, post.post_type, post.permalink,
          post.platform,
          post.views, post.reach, post.likes, post.comments, post.shares,
          post.total_clicks, post.link_clicks, post.other_clicks,
          post.saves, post.follows,
          post.interactions, post.engagement
        );

        if (exists) {
          updated++;
        } else {
          inserted++;
        }
      }

      // Update the import row_count to reflect actual inserts
      // (some posts may have been updates of existing posts)
      const actualPostCount = db.prepare(
        'SELECT COUNT(*) AS count FROM posts WHERE import_id = ?'
      ).get(importId).count;

      db.prepare('UPDATE imports SET row_count = ? WHERE id = ?')
        .run(actualPostCount, importId);

      return { importId, inserted, updated, actualPostCount };
    })();

    // Re-run collab detection across all data
    const collabResult = redetectAllCollabs();

    res.status(201).json({
      import: {
        id: result.importId,
        filename: req.file.originalname,
        platform: parsed.platform,
        month: parsed.month,
        row_count: result.actualPostCount,
        date_range_start: parsed.dateRangeStart,
        date_range_end: parsed.dateRangeEnd,
      },
      stats: {
        totalRowsInFile: parsed.stats.totalRows,
        parsedPosts: parsed.stats.parsedPosts,
        duplicatesRemoved: parsed.stats.duplicatesRemoved,
        postsInserted: result.inserted,
        postsUpdated: result.updated,
        collabDetection: collabResult,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/imports/:id — delete import and its posts (CASCADE)
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Ogiltigt import-ID.' });
  }

  const existing = db.prepare('SELECT id FROM imports WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Import hittades inte.' });
  }

  db.prepare('DELETE FROM imports WHERE id = ?').run(id);

  // Re-run collab detection since account post counts have changed
  const collabResult = redetectAllCollabs();

  res.json({
    deleted: true,
    id,
    collabDetection: collabResult,
  });
});

export default router;
