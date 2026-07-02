import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { importViewersCSV, getViewersMonths, deleteViewersMonth } from '../services/viewersImporter.js';
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

// POST / — upload FB unique viewers CSV (month auto-detected from Period_start)
router.post('/', uploadLimiter, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil bifogades.' });
  }

  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);

    const result = importViewersCSV(csvContent, req.file.originalname);

    res.status(201).json({
      type: 'viewers',
      month: result.month,
      imported: result.imported,
      skipped: result.skipped,
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: err.message });
  }
});

// GET /months — which months have viewers data
router.get('/months', (req, res) => {
  const months = getViewersMonths();
  res.json({ months });
});

// DELETE /:month — delete viewers data for a month
router.delete('/:month', (req, res) => {
  if (!/^\d{4}-\d{2}$/.test(req.params.month)) {
    return res.status(400).json({ error: 'Ogiltigt månadsformat. Förväntat: YYYY-MM.' });
  }
  const result = deleteViewersMonth(req.params.month);
  res.json({ deleted: result.changes });
});

export default router;
