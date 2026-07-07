import { Router } from 'express';
import fs from 'fs';
import { getDb } from '../db/connection.js';

const router = Router();

// GET /api/health
router.get('/health', (req, res) => {
  try {
    const db = getDb();
    const postCount = db.prepare('SELECT COUNT(*) AS count FROM posts').get().count;
    const dbPath = process.env.DB_PATH || './data/analytics.db';
    let dbSize = '0 B';
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      const bytes = stats.size;
      if (bytes < 1024) dbSize = `${bytes} B`;
      else if (bytes < 1024 * 1024) dbSize = `${(bytes / 1024).toFixed(1)} KB`;
      else dbSize = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    res.json({ status: 'ok', dbSize, posts: postCount });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// GET /api/maintenance/stats
router.get('/stats', (req, res) => {
  const db = getDb();
  const postCount = db.prepare('SELECT COUNT(*) AS count FROM posts').get().count;
  const importCount = db.prepare('SELECT COUNT(*) AS count FROM imports').get().count;
  const dateRange = db.prepare(
    'SELECT MIN(publish_time) AS earliest, MAX(publish_time) AS latest FROM posts'
  ).get();

  const dbPath = process.env.DB_PATH || './data/analytics.db';
  let fileSizeBytes = 0;
  if (fs.existsSync(dbPath)) {
    fileSizeBytes = fs.statSync(dbPath).size;
  }

  res.json({
    posts: postCount,
    imports: importCount,
    earliest: dateRange.earliest,
    latest: dateRange.latest,
    fileSizeBytes,
    fileSize: fileSizeBytes < 1024 * 1024
      ? `${(fileSizeBytes / 1024).toFixed(1)} KB`
      : `${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`
  });
});

// POST /api/maintenance/vacuum
router.post('/vacuum', (req, res) => {
  const db = getDb();
  db.exec('VACUUM');
  res.json({ status: 'ok', message: 'Databasen har komprimerats.' });
});

// POST /api/maintenance/redetect-collab
router.post('/redetect-collab', async (req, res) => {
  try {
    // Dynamically import to avoid circular deps at startup
    const { redetectAllCollabs } = await import('../services/collabDetector.js');
    const result = redetectAllCollabs();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/maintenance/backup
// Online-backup via better-sqlite3 db.backup() (WAL-konsistent snapshot) —
// att streama den levande filen direkt kan ge en trasig kopia om en import
// checkpointar mitt under nedladdningen.
router.get('/backup', async (req, res) => {
  const dbPath = process.env.DB_PATH || './data/analytics.db';
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'Databasfil hittades inte.' });
  }

  const db = getDb();
  const stamp = new Date().toISOString().slice(0, 10);
  const tmpPath = `${dbPath}.download-${process.pid}-${Date.now()}`;

  try {
    await db.backup(tmpPath);

    const check = new (db.constructor)(tmpPath, { readonly: true });
    const integrity = check.pragma('integrity_check', { simple: true });
    check.close();
    if (integrity !== 'ok') {
      throw new Error(`Integritetskontrollen misslyckades: ${integrity}`);
    }

    res.setHeader('Content-Disposition', `attachment; filename="analytics-backup-${stamp}.db"`);
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Length', fs.statSync(tmpPath).size);

    const stream = fs.createReadStream(tmpPath);
    const cleanup = () => fs.unlink(tmpPath, () => {});
    stream.on('close', cleanup);
    stream.on('error', cleanup);
    stream.pipe(res);
  } catch (err) {
    fs.unlink(tmpPath, () => {});
    res.status(500).json({ error: `Backup misslyckades: ${err.message}` });
  }
});

export default router;
