/**
 * TikTok Översikt router — /api/tiktok-overview
 * Upload, retrieval och deletion av TikTok-Översiktsdata (per dag/konto).
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import express from 'express';
import {
  importTikTokOverviewCSV,
  getTikTokOverviewMonths,
  getTikTokOverviewAccounts,
  getTikTokOverviewMonthlySummary,
  getTikTokOverviewDaily,
  deleteTikTokOverviewMonth,
  deleteTikTokOverviewByAccount,
} from '../services/tiktokOverviewImporter.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';

const router = Router();

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

// POST / — ladda upp en TikTok Översikt-CSV
// Form-fält: file (CSV), accountUsername (handle), accountName (display, valfritt)
router.post('/', uploadLimiter, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil bifogades.' });
  }
  const accountUsername = (req.body.accountUsername || '').trim();
  if (!accountUsername) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'accountUsername (TikTok-handle) måste anges.' });
  }
  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);
    const result = importTikTokOverviewCSV(csvContent, {
      accountUsername,
      accountName: req.body.accountName,
      filename: req.file.originalname,
    });
    res.status(201).json({
      type: 'tiktok_overview',
      ...result,
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: err.message });
  }
});

// GET /months — distinkta månader med Översikt-data
router.get('/months', (req, res) => {
  res.json({ months: getTikTokOverviewMonths() });
});

// GET /accounts — distinkta konton (handle + display + räknare)
router.get('/accounts', (req, res) => {
  res.json({ accounts: getTikTokOverviewAccounts() });
});

// GET /summary?months=YYYY-MM,YYYY-MM — månadsaggregat per konto
router.get('/summary', (req, res) => {
  const months = req.query.months
    ? req.query.months.split(',').map(m => m.trim()).filter(Boolean)
    : null;
  res.json({ summary: getTikTokOverviewMonthlySummary(months) });
});

// GET /daily?account=<handle>&months=...
router.get('/daily', (req, res) => {
  const account = req.query.account;
  if (!account) return res.status(400).json({ error: 'account (handle) krävs.' });
  const months = req.query.months
    ? req.query.months.split(',').map(m => m.trim()).filter(Boolean)
    : null;
  res.json({ daily: getTikTokOverviewDaily(account, months) });
});

// DELETE /by-account?account=<handle>&month=YYYY-MM
// Måste komma före /:month för att inte fångas av parametriserade routen.
router.delete('/by-account', express.json(), (req, res) => {
  const account = req.query.account;
  const month = req.query.month;
  if (!account || !month) {
    return res.status(400).json({ error: 'account och month krävs.' });
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Ogiltigt månadsformat. Förväntat: YYYY-MM.' });
  }
  const result = deleteTikTokOverviewByAccount(account, month);
  res.json({ deleted: result.changes, account, month });
});

// DELETE /:month — radera hela månadens data (alla konton)
router.delete('/:month', (req, res) => {
  if (!/^\d{4}-\d{2}$/.test(req.params.month)) {
    return res.status(400).json({ error: 'Ogiltigt månadsformat. Förväntat: YYYY-MM.' });
  }
  const result = deleteTikTokOverviewMonth(req.params.month);
  res.json({ deleted: result.changes });
});

export default router;
