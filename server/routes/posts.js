import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { buildPeriodConditions } from '../utils/periodFilter.js';

const router = Router();

// Allowed sort columns to prevent SQL injection
const ALLOWED_SORT = new Set([
  'publish_time', 'views', 'reach', 'likes', 'comments', 'shares',
  'total_clicks', 'link_clicks', 'other_clicks', 'saves', 'follows',
  'interactions', 'engagement', 'account_name', 'post_type'
]);

// GET /api/posts?page=1&pageSize=20&sort=publish_time&order=desc&account=X&platform=facebook&month=2026-01
router.get('/', (req, res) => {
  const db = getDb();

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const sort = ALLOWED_SORT.has(req.query.sort) ? req.query.sort : 'publish_time';
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  // Build WHERE clauses
  const conditions = [];
  const params = [];

  // Period filtering
  const periodFilter = buildPeriodConditions(req.query);
  conditions.push(...periodFilter.conditions);
  params.push(...periodFilter.params);

  if (req.query.platform) {
    conditions.push('platform = ?');
    params.push(req.query.platform);
  }

  if (req.query.account) {
    conditions.push('(account_id = ? OR account_name = ?)');
    params.push(req.query.account, req.query.account);
  }

  if (req.query.month) {
    conditions.push("strftime('%Y-%m', publish_time) = ?");
    params.push(req.query.month);
  }

  if (req.query.postType) {
    conditions.push('post_type = ?');
    params.push(req.query.postType);
  }

  if (req.query.excludeCollab === 'true') {
    conditions.push('is_collab = 0');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM posts ${whereClause}`).get(...params);
  const total = countRow.total;

  // Fetch page
  const data = db.prepare(
    `SELECT * FROM posts ${whereClause} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);

  res.json({
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
});

export default router;
