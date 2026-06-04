/**
 * Export API — flat .xlsx for Power BI and other analysis tools.
 */
import { Router } from 'express';
import { buildFlatWorkbookBuffer } from '../services/export/flatExport.js';

const router = Router();

// GET /api/export/flat — one .xlsx with a sheet per view (account×month / group×month).
router.get('/flat', (req, res) => {
  try {
    const buf = buildFlatWorkbookBuffer();
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="metadb-export-${date}.xlsx"`);
    res.send(buf);
  } catch (err) {
    console.error('Flat export error:', err);
    res.status(500).json({ error: 'Kunde inte skapa exportfilen.' });
  }
});

export default router;
