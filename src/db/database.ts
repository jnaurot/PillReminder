import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { getOrCreateDbKey } from './cryptoKey';

const SCHEMA_VERSION = 11;
const ENC_DB_NAME   = 'pillreminder_enc.db';
const LEGACY_DB_NAME = 'pillreminder.db';

// ---------------------------------------------------------------------------
// Compatibility wrapper — exposes the same async API as expo-sqlite so every
// other file in src/db/ works without changes.
// ---------------------------------------------------------------------------

class CompatDB {
  constructor(private inner: DB) {}

  async execAsync(sql: string): Promise<void> {
    const stmts = sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    for (const stmt of stmts) {
      await this.inner.execute(stmt);
    }
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.inner.execute(sql, params as any[]);
    return (result.rows ?? []) as T[];
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.inner.execute(sql, params as any[]);
    return ((result.rows ?? [])[0] ?? null) as T | null;
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    const result = await this.inner.execute(sql, params as any[]);
    return {
      changes: result.rowsAffected ?? 0,
      lastInsertRowId: result.insertId ?? 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _db: CompatDB | null = null;

export function getDb(): CompatDB {
  if (!_db) throw new Error('Database not initialized — call initDb() first.');
  return _db;
}

// ---------------------------------------------------------------------------
// One-time migration: copy every row from the old unencrypted DB into the
// newly-created encrypted one, then delete the legacy file.
// ---------------------------------------------------------------------------

async function migrateFromLegacy(inner: DB): Promise<void> {
  // Use expo-sqlite to open the legacy DB — it knows the correct platform path
  // and handles WAL mode properly since it created the file.
  let legacy: ReturnType<typeof openDatabaseSync> | null = null;
  try {
    legacy = openDatabaseSync(LEGACY_DB_NAME);
    const check = legacy.getAllSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entities'",
    );
    if (!check.length) {
      legacy.closeSync();
      return;
    }
  } catch {
    try { legacy?.closeSync(); } catch { /* ignore */ }
    return;
  }

  const TABLES = [
    'settings', 'entities', 'medications', 'prescriptions',
    'dose_logs', 'caregivers', 'caregiver_shifts', 'native_alarms',
  ];

  inner.executeSync('BEGIN EXCLUSIVE TRANSACTION');
  try {
    for (const table of TABLES) {
      let rows: Record<string, unknown>[];
      try {
        rows = legacy.getAllSync<Record<string, unknown>>(`SELECT * FROM ${table}`);
      } catch {
        continue;
      }

      for (const row of rows) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        inner.executeSync(
          `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => row[c]) as any[],
        );
      }
    }
    inner.executeSync('COMMIT');
  } catch (err) {
    inner.executeSync('ROLLBACK');
    legacy.closeSync();
    throw err;
  }

  legacy.closeSync();

  // Delete legacy DB files (WAL mode leaves -wal and -shm alongside the main file).
  const legacyDir = (FileSystem.documentDirectory ?? '') + 'SQLite/';
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      await FileSystem.deleteAsync(legacyDir + LEGACY_DB_NAME + suffix, { idempotent: true });
    } catch { /* non-fatal */ }
  }
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

function createSchema(inner: DB): void {
  inner.executeSync(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS entities (
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
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS medications (
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
    rxcui                TEXT,
    drug_info            TEXT,
    pill_appearance      TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS prescriptions (
    id            TEXT PRIMARY KEY,
    medication_id TEXT NOT NULL REFERENCES medications(id),
    refill_date   TEXT NOT NULL,
    quantity      INTEGER NOT NULL,
    days_supply   INTEGER,
    unit          TEXT NOT NULL DEFAULT 'pills',
    created_at    TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS dose_logs (
    id            TEXT PRIMARY KEY,
    medication_id TEXT NOT NULL REFERENCES medications(id),
    scheduled_at  TEXT NOT NULL,
    taken_at      TEXT,
    skipped       INTEGER NOT NULL DEFAULT 0,
    is_catchup    INTEGER NOT NULL DEFAULT 0,
    notes         TEXT,
    created_at    TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS caregivers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS caregiver_shifts (
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
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS native_alarms (
    alarm_id TEXT PRIMARY KEY,
    med_id   TEXT NOT NULL
  )`);
}

function insertDefaultSettings(inner: DB): void {
  const defaults: [string, string][] = [
    ['early_window_minutes',  '30'],
    ['missed_window_minutes', '60'],
    ['global_missed_policy',  'none'],
    ['refill_alert_days',     '7'],
    ['alarm_enabled',         'false'],
    ['alarm_delay_minutes',   '30'],
    ['alarm_type',            'sound,vibration'],
  ];
  for (const [k, v] of defaults) {
    inner.executeSync('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v]);
  }
}

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------

export async function initDb(): Promise<void> {
  const key   = await getOrCreateDbKey();
  const inner = open({ name: ENC_DB_NAME, encryptionKey: key });

  inner.executeSync('PRAGMA journal_mode = WAL');
  inner.executeSync('PRAGMA foreign_keys = ON');

  const vRow = inner.executeSync('PRAGMA user_version').rows?.[0] as
    { user_version: number } | undefined;
  const currentVersion = vRow?.user_version ?? 0;

  // Pre-v6 data is incompatible — wipe and start fresh.
  if (currentVersion > 0 && currentVersion < 6) {
    inner.executeSync('PRAGMA foreign_keys = OFF');
    for (const t of ['dose_logs', 'prescriptions', 'medications', 'entities', 'settings']) {
      inner.executeSync(`DROP TABLE IF EXISTS ${t}`);
    }
    inner.executeSync('PRAGMA foreign_keys = ON');
  }

  createSchema(inner);

  // Ensure all schema columns exist regardless of version — safe to run always.
  const addCol = (table: string, col: string, def: string) => {
    try { inner.executeSync(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
  };
  addCol('medications', 'rxcui',           'TEXT');
  addCol('medications', 'drug_info',       'TEXT');
  addCol('medications', 'pill_appearance', 'TEXT');

  // Incremental migrations on existing encrypted DB.
  if (currentVersion > 0) {
    if (currentVersion >= 6 && currentVersion < 9) {
      for (const [k, v] of [
        ['alarm_enabled', 'false'], ['alarm_delay_minutes', '30'], ['alarm_type', 'sound,vibration'],
      ] as [string, string][]) {
        inner.executeSync('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v]);
      }
    }

    if (currentVersion === 6) {
      addCol('entities',          'shift_source',    "TEXT NOT NULL DEFAULT 'local'");
      addCol('entities',          'shared_shift_id', 'TEXT');
      addCol('entities',          'primary_phone',   'TEXT');
      addCol('caregiver_shifts',  'primary_phone',   "TEXT NOT NULL DEFAULT ''");
    }

  }

  // If entities is empty, attempt legacy migration. migrateFromLegacy opens the
  // old expo-sqlite DB and returns early if it has no data (fresh install or
  // already migrated). The legacy file is deleted on success, self-limiting.
  {
    const entityCount = inner.executeSync('SELECT COUNT(*) as n FROM entities').rows?.[0] as
      { n: number } | undefined;
    if ((entityCount?.n ?? 0) === 0) {
      await migrateFromLegacy(inner);
    }
  }

  // Insert default settings for any version (INSERT OR IGNORE — won't overwrite existing).
  insertDefaultSettings(inner);

  inner.executeSync(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  _db = new CompatDB(inner);
}
