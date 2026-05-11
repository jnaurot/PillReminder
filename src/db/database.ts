import * as SQLite from 'expo-sqlite';

const SCHEMA_VERSION = 10;

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

  if (currentVersion < 6) {
    // Breaking schema change before v6 — drop everything and start fresh.
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
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      dob             TEXT,
      notes           TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      deleted_at      TEXT,
      shift_source    TEXT NOT NULL DEFAULT 'local',
      shared_shift_id TEXT,
      primary_phone   TEXT
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

    CREATE TABLE IF NOT EXISTS caregivers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS caregiver_shifts (
      id                TEXT PRIMARY KEY,
      caregiver_id      TEXT NOT NULL REFERENCES caregivers(id),
      entity_ids        TEXT NOT NULL DEFAULT '["*"]',
      start_time        TEXT NOT NULL,
      end_time          TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      confirmation_code TEXT NOT NULL,
      notes             TEXT,
      primary_phone     TEXT NOT NULL DEFAULT '',
      created_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS native_alarms (
      alarm_id TEXT PRIMARY KEY,
      med_id   TEXT NOT NULL
    );
  `);

  if (currentVersion < 6) {
    await _db.execAsync(`
      INSERT OR IGNORE INTO settings (key, value) VALUES
        ('early_window_minutes', '30'),
        ('missed_window_minutes', '60'),
        ('global_missed_policy', 'none'),
        ('refill_alert_days', '7'),
        ('alarm_enabled', 'false'),
        ('alarm_delay_minutes', '30'),
        ('alarm_type', 'sound,vibration');
    `);
  }

  if (currentVersion >= 6 && currentVersion < 9) {
    await _db.execAsync(`
      INSERT OR IGNORE INTO settings (key, value) VALUES
        ('alarm_enabled', 'false'),
        ('alarm_delay_minutes', '30'),
        ('alarm_type', 'sound,vibration');
    `);
  }

  // v10: native_alarms table created via CREATE TABLE IF NOT EXISTS above

  const addCol = async (table: string, col: string, def: string) => {
    try {
      await _db!.execAsync(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch { /* column already exists */ }
  };

  if (currentVersion === 6) {
    await addCol('entities', 'shift_source',    "TEXT NOT NULL DEFAULT 'local'");
    await addCol('entities', 'shared_shift_id', 'TEXT');
    await addCol('entities', 'primary_phone',   'TEXT');
    await addCol('caregiver_shifts', 'primary_phone', "TEXT NOT NULL DEFAULT ''");
  }

  if (currentVersion < 8) {
    await addCol('medications', 'rxcui',          'TEXT');
    await addCol('medications', 'drug_info',       'TEXT');
    await addCol('medications', 'pill_appearance', 'TEXT');
  }

  await _db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
