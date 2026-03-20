import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// GET /api/post-types?account=all&fields=views,reach,likes&platform=facebook
router.get('/', (req, res) => {
  const db = getDb();

  const conditions = [];
  const params = [];

  if (req.query.platform) {
    conditions.push('platform = ?');
    params.push(req.query.platform);
  }

  if (req.query.account && req.query.account !== 'all') {
    conditions.push('(account_id = ? OR account_name = ?)');
    params.push(req.query.account, req.query.account);
  }

  if (req.query.excludeCollab === 'true') {
    conditions.push('is_collab = 0');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT
      post_type,
      COUNT(*) AS post_count,
      CAST(ROUND(AVG(views)) AS INTEGER) AS avg_views,
      CAST(ROUND(AVG(reach)) AS INTEGER) AS avg_reach,
      CAST(ROUND(AVG(likes)) AS INTEGER) AS avg_likes,
      CAST(ROUND(AVG(comments)) AS INTEGER) AS avg_comments,
      CAST(ROUND(AVG(shares)) AS INTEGER) AS avg_shares,
      CAST(ROUND(AVG(total_clicks)) AS INTEGER) AS avg_total_clicks,
      CAST(ROUND(AVG(link_clicks)) AS INTEGER) AS avg_link_clicks,
      CAST(ROUND(AVG(other_clicks)) AS INTEGER) AS avg_other_clicks,
      CAST(ROUND(AVG(saves)) AS INTEGER) AS avg_saves,
      CAST(ROUND(AVG(follows)) AS INTEGER) AS avg_follows,
      CAST(ROUND(AVG(interactions)) AS INTEGER) AS avg_interactions,
      CAST(ROUND(AVG(engagement)) AS INTEGER) AS avg_engagement,
      SUM(views) AS total_views,
      SUM(likes) AS total_likes,
      SUM(comments) AS total_comments,
      SUM(shares) AS total_shares,
      SUM(interactions) AS total_interactions,
      SUM(engagement) AS total_engagement
    FROM posts
    ${whereClause}
    GROUP BY post_type
    ORDER BY post_count DESC
  `;

  const data = db.prepare(query).all(...params);

  res.json(data);
});

export default router;
