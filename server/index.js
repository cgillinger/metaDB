import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './db/connection.js';
import { errorHandler } from './middleware/errorHandler.js';
import maintenanceRouter from './routes/maintenance.js';
import importsRouter from './routes/imports.js';
import postsRouter from './routes/posts.js';
import accountsRouter from './routes/accounts.js';
import postTypesRouter from './routes/postTypes.js';
import trendsRouter from './routes/trends.js';
import reachRouter from './routes/reach.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3001;

const app = express();

app.use(express.json());

// Initialize database on startup
getDb();
console.log('Database initialized.');

// API routes
app.use('/api/health', (req, res, next) => {
  req.url = '/health';
  maintenanceRouter(req, res, next);
});
app.use('/api/imports', importsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/post-types', postTypesRouter);
app.use('/api/trends', trendsRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/reach', reachRouter);

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
