import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || './data/analytics.db';

let db;

export function getDb() {
  if (db) return db;

  // Ensure the directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  // Wait up to 5 s when the DB is locked instead of failing immediately
  db.pragma('busy_timeout = 5000');
  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Run initial schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Run migrations
  runMigrations(db);

  return db;
}

function runMigrations(db) {
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) return;

  // Get current version
  const currentVersion = db.prepare(
    'SELECT COALESCE(MAX(version), 0) AS version FROM schema_version'
  ).get().version;

  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);
    if (isNaN(version) || version <= currentVersion) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    // Foreign-key enforcement must be toggled OUTSIDE a transaction — PRAGMA
    // foreign_keys is a no-op within one. Migrations that rebuild an
    // FK-referenced table via the table-swap pattern (DROP + recreate) would
    // otherwise fire ON DELETE CASCADE and silently wipe child rows. Disable
    // enforcement around the migration, then re-enable and verify integrity.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
      })();
      const violations = db.pragma('foreign_key_check');
      if (violations.length > 0) {
        throw new Error(
          `Migration ${file} left ${violations.length} foreign key violation(s): ` +
          JSON.stringify(violations)
        );
      }
    } finally {
      db.pragma('foreign_keys = ON');
    }

    console.log(`Applied migration ${file}`);
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}
