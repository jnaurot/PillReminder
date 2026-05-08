import * as SQLite from 'expo-sqlite';

const SCHEMA_VERSION = 6;

let _db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

export async function initDb(): Promise<void> {
  _db = await SQLite.openDatabaseAsync('pillreminder.db');

  const versionRow = await _db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion < SCHEMA_VERSION) {
    await _db.execAsync(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS dose_logs;
      DROP TABLE IF EXISTS prescriptions;
      DROP TABLE IF EXISTS medications;
      DROP TABLE IF EXISTS entities;
      DROP TABLE IF EXISTS settings;
      PRAGMA foreign_keys = ON;
    `);
  }

  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entities (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      dob         TEXT,
      notes       TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      deleted_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS medications (
      id                   TEXT PRIMARY KEY,
      entity_id            TEXT NOT NULL REFERENCES entities(id),
      name                 TEXT NOT NULL,
      dosage               TEXT NOT NULL,
      pills_per_dose       INTEGER NOT NULL DEFAULT 1,
      schedule             TEXT NOT NULL DEFAULT '{"type":"fixed_times","times":[]}',
      food_requirement     TEXT,
      interactions         TEXT NOT NULL DEFAULT '[]',
      missed_policy        TEXT,
      early_window_minutes INTEGER,
      color                TEXT NOT NULL DEFAULT '#4A90D9',
      notes                TEXT,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      deleted_at           TEXT
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id            TEXT PRIMARY KEY,
      medication_id TEXT NOT NULL REFERENCES medications(id),
      refill_date   TEXT NOT NULL,
      quantity      INTEGER NOT NULL,
      days_supply   INTEGER,
      unit          TEXT NOT NULL DEFAULT 'pills',
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dose_logs (
      id            TEXT PRIMARY KEY,
      medication_id TEXT NOT NULL REFERENCES medications(id),
      scheduled_at  TEXT NOT NULL,
      taken_at      TEXT,
      skipped       INTEGER NOT NULL DEFAULT 0,
      is_catchup    INTEGER NOT NULL DEFAULT 0,
      notes         TEXT,
      created_at    TEXT NOT NULL
    );
  `);

  if (currentVersion < SCHEMA_VERSION) {
    await _db.execAsync(`
      INSERT OR IGNORE INTO settings (key, value) VALUES
        ('early_window_minutes', '30'),
        ('missed_window_minutes', '60'),
        ('global_missed_policy', 'none'),
        ('refill_alert_days', '7');
    `);
  }

  await _db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
