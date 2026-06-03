import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { importReachCSV, getReachMonths, deleteReachMonth } from '../services/reachImporter.js';
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

// POST / — upload API-level reach CSV
// Expects multipart form with 'file' and 'month' (YYYY-MM)
// uploadLimiter: max 10 uploads per minute to prevent abuse
router.post('/', uploadLimiter, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil bifogades.' });
  }

  const month = req.body.month || null;  // null triggers auto-detect in importer

  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);

    const result = importReachCSV(csvContent, month, req.file.originalname);

    res.status(201).json({
      type: 'reach',
      month: result.month,
      imported: result.imported,
      skipped: result.skipped,
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: err.message });
  }
});

// GET /months — which months have reach data
router.get('/months', (req, res) => {
  const months = getReachMonths();
  res.json({ months });
});

// DELETE /:month — delete reach data for a month
router.delete('/:month', (req, res) => {
  // Validate month format to prevent unexpected values reaching the DB
  if (!/^\d{4}-\d{2}$/.test(req.params.month)) {
    return res.status(400).json({ error: 'Ogiltigt månadsformat. Förväntat: YYYY-MM.' });
  }
  const result = deleteReachMonth(req.params.month);
  res.json({ deleted: result.changes });
});

export default router;
