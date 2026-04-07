/**
 * GA Listens router — /api/ga-listens
 * Handles upload, retrieval, and deletion of Google Analytics listening data.
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { getDb } from '../db/connection.js';
import express from 'express';
import {
  importGaListensCSV,
  getGaListens,
  getGaListensMonths,
  deleteGaListensMonth,
  deleteGaListensByAccount,
  deleteGaListensAccounts,
} from '../services/gaListensImporter.js';
import { hiddenGAFilter } from '../services/hiddenAccounts.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';

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

// POST / — upload GA listens CSV
// Expects multipart form with 'file' and 'month' (YYYY-MM)
// uploadLimiter: max 10 uploads per minute to prevent abuse
router.post('/', uploadLimiter, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil bifogades.' });
  }

  const month = req.body.month;
  if (!month) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Månad (month) måste anges i formatet YYYY-MM.' });
  }

  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);

    const result = importGaListensCSV(csvContent, month, req.file.originalname);

    res.status(201).json({
      type: 'ga_listens',
      month: result.month,
      imported: result.imported,
      skipped: result.skipped,
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: err.message });
  }
});

// GET /summary — aggregated listens per programme across selected months
router.get('/summary', (req, res) => {
  const db = getDb();

  const monthsParam = req.query.months;
  const conditions = [];
  const params = [];

  if (monthsParam) {
    const monthList = monthsParam.split(',').map(m => m.trim()).filter(Boolean);
    if (monthList.length > 0) {
      const placeholders = monthList.map(() => '?').join(',');
      conditions.push(`month IN (${placeholders})`);
      params.push(...monthList);
    }
  }

  // Hidden accounts filter
  conditions.push(hiddenGAFilter().slice(4));

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

  const rows = db.prepare(`
    SELECT
      account_name,
      SUM(listens) AS total_listens,
      COUNT(DISTINCT month) AS month_count
    FROM ga_listens
    ${whereClause}
    GROUP BY account_name
    ORDER BY total_listens ${order}
  `).all(...params);

  const totalRow = db.prepare(`
    SELECT SUM(listens) AS grand_total
    FROM ga_listens
    ${whereClause}
  `).get(...params);

  res.json({
    programmes: rows,
    grandTotal: totalRow?.grand_total || 0,
  });
});

// GET / — get GA listens data, optional ?months=YYYY-MM,YYYY-MM
router.get('/', (req, res) => {
  const monthsParam = req.query.months;
  const months = monthsParam
    ? monthsParam.split(',').map(m => m.trim()).filter(Boolean)
    : null;

  const rows = getGaListens(months);
  res.json({ data: rows });
});

// GET /months — which months have GA listens data
router.get('/months', (req, res) => {
  const months = getGaListensMonths();
  res.json({ months });
});

/**
 * DELETE /by-accounts — batch-delete GA listens data for specific account names.
 * Expects JSON body: { accountNames: string[] }
 * Deletes ALL months for the given account names.
 */
router.delete('/by-accounts', express.json(), (req, res) => {
  const { accountNames } = req.body;

  if (!Array.isArray(accountNames) || accountNames.length === 0) {
    return res.status(400).json({ error: 'accountNames måste vara en icke-tom array.' });
  }

  // Sanitise: trim, deduplicate, remove empties
  const cleaned = [...new Set(accountNames.map(n => n.trim()).filter(Boolean))];
  if (cleaned.length === 0) {
    return res.status(400).json({ error: 'Inga giltiga kontonamn angavs.' });
  }

  const result = deleteGaListensAccounts(cleaned);
  res.json({ deleted: result.deleted, accountNames: cleaned });
});

// DELETE /by-account — delete GA listens for a specific account within given months
// Must be registered BEFORE /:month to prevent that route from capturing "by-account"
router.delete('/by-account', (req, res) => {
  const { accountName, months: monthsParam } = req.query;

  if (!accountName) {
    return res.status(400).json({ error: 'accountName krävs.' });
  }

  if (!monthsParam) {
    return res.status(400).json({ error: 'months krävs.' });
  }

  const monthsArray = monthsParam.split(',').map(m => m.trim()).filter(Boolean);
  const invalid = monthsArray.find(m => !/^\d{4}-\d{2}$/.test(m));
  if (invalid || monthsArray.length === 0) {
    return res.status(400).json({ error: 'Ogiltigt månadsformat. Förväntat: YYYY-MM.' });
  }

  const deleted = deleteGaListensByAccount(accountName, monthsArray);
  res.json({ deleted, accountName });
});

// DELETE /:month — delete GA listens data for a month
router.delete('/:month', (req, res) => {
  // Validate month format to prevent unexpected values reaching the DB
  if (!/^\d{4}-\d{2}$/.test(req.params.month)) {
    return res.status(400).json({ error: 'Ogiltigt månadsformat. Förväntat: YYYY-MM.' });
  }
  const result = deleteGaListensMonth(req.params.month);
  res.json({ deleted: result.changes });
});

export default router;
