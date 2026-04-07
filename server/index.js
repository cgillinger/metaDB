import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, unlinkSync, existsSync } from 'fs';
import helmet from 'helmet';
import { getDb, closeDb } from './db/connection.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiLimiter, backupLimiter } from './middleware/rateLimiters.js';
import { requireAdmin } from './middleware/adminAuth.js';
import maintenanceRouter from './routes/maintenance.js';
import importsRouter from './routes/imports.js';
import postsRouter from './routes/posts.js';
import accountsRouter from './routes/accounts.js';
import postTypesRouter from './routes/postTypes.js';
import trendsRouter from './routes/trends.js';
import reachRouter from './routes/reach.js';
import gaListensRouter from './routes/gaListens.js';
import accountGroupsRouter from './routes/accountGroups.js';
import hiddenAccountsRouter from './routes/hiddenAccounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3001;

const app = express();

// Limit JSON request body size to prevent payload-based DoS
app.use(express.json({ limit: '1mb' }));

// Security headers (CSP, X-Frame-Options, X-Content-Type-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
}));

// Broad rate limiting for all API routes (200 requests per minute)
app.use('/api/', apiLimiter);

// Initialize database on startup
getDb();
console.log('Database initialized.');

// Remove any temp upload files left over from a previous unclean shutdown
const TMP_UPLOAD_DIR = '/tmp/meta-uploads/';
if (existsSync(TMP_UPLOAD_DIR)) {
  for (const f of readdirSync(TMP_UPLOAD_DIR)) {
    try { unlinkSync(path.join(TMP_UPLOAD_DIR, f)); } catch {}
  }
}

// API routes
app.use('/api/health', (req, res, next) => {
  req.url = '/health';
  maintenanceRouter(req, res, next);
});

// Backup: rate-limited (max 2/min) but no admin token required — must be
// registered before the requireAdmin-guarded /api/maintenance mount below
app.get('/api/maintenance/backup', backupLimiter, (req, res, next) => {
  req.url = '/backup';
  maintenanceRouter(req, res, next);
});

// All other maintenance endpoints (stats, vacuum, redetect-collab):
// require X-Admin-Token header when ADMIN_TOKEN env var is set
app.use('/api/maintenance', requireAdmin, maintenanceRouter);

app.use('/api/hidden-accounts', hiddenAccountsRouter);
app.use('/api/imports', importsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/post-types', postTypesRouter);
app.use('/api/trends', trendsRouter);
app.use('/api/reach', reachRouter);
app.use('/api/ga-listens', gaListensRouter); // Google Analytics listening data
app.use('/api/account-groups', accountGroupsRouter);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));

  // SPA fallback — serve index.html for non-API routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Endpoint hittades inte.' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Error handler
app.use(errorHandler);

const server = app.listen(PORT, HOST, () => {
  console.log(`Meta Analytics server running at http://${HOST}:${PORT}`);
  if (process.env.NODE_ENV === 'production') {
    console.log('Serving frontend from dist/');
  } else {
    console.log('Development mode — use Vite dev server for frontend');
  }
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;
