import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { importReachCSV, getReachMonths, deleteReachMonth } from '../services/reachImporter.js';

const router = Router();
const upload = multer({ dest: '/tmp/meta-uploads/' });

// POST / — upload API-level reach CSV
// Expects multipart form with 'file' and 'month' (YYYY-MM)
router.post('/', upload.single('file'), (req, res) => {
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
  const result = deleteReachMonth(req.params.month);
  res.json({ deleted: result.changes });
});

export default router;
