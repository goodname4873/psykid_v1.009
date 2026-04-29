const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

/**
 * Simple database migration framework for SQLite.
 *
 * How it works:
 * 1. A `t_migration` table tracks which migrations have been applied.
 * 2. Migration files live in ./migrations/ named like 001_description.js
 * 3. On startup, runMigrations(db) scans the directory, compares with
 *    the table, and executes any new ones in order.
 *
 * Each migration file exports:
 *   module.exports = {
 *     name: 'human readable name',
 *     up(db) { db.exec('ALTER TABLE ...') }
 *   }
 */

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_migration (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
}

function getAppliedVersions(db) {
  return db.prepare('SELECT version FROM t_migration ORDER BY version ASC')
    .all()
    .map(r => r.version);
}

function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_.*\.js$/.test(f))
    .sort()
    .map(f => {
      const version = parseInt(f.substring(0, 3), 10);
      const mod = require(path.join(MIGRATIONS_DIR, f));
      return { version, file: f, name: mod.name || f, up: mod.up };
    });
}

function runMigrations(db) {
  ensureMigrationTable(db);

  const applied = getAppliedVersions(db);
  const all = discoverMigrations();
  const pending = all.filter(m => !applied.includes(m.version));

  if (pending.length === 0) {
    console.log('[Migration] Database is up to date.');
    return;
  }

  console.log(`[Migration] ${pending.length} pending migration(s) found.`);

  const insertStmt = db.prepare(
    'INSERT INTO t_migration (version, name) VALUES (?, ?)'
  );

  for (const migration of pending) {
    try {
      console.log(`[Migration] Running ${migration.file}: ${migration.name} ...`);
      // Run inside transaction for safety
      db.transaction(() => {
        migration.up(db);
        insertStmt.run(migration.version, migration.name);
      })();
      console.log(`[Migration] ✓ ${migration.file} applied.`);
    } catch (err) {
      console.error(`[Migration] ✗ ${migration.file} FAILED:`, err.message);
      throw err; // Stop on failure — don't skip broken migrations
    }
  }

  console.log('[Migration] All migrations applied successfully.');
}

module.exports = { runMigrations };
