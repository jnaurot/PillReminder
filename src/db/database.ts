import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { getOrCreateDbKey } from './cryptoKey';

const SCHEMA_VERSION = 13;
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
    primary_phone   TEXT,
    delegation_owner_device_id TEXT,
    delegation_imported_at TEXT,
    delegation_expires_at TEXT,
    delegation_cleanup_pending INTEGER NOT NULL DEFAULT 0,
    delegation_version INTEGER,
    delegation_source_transfer_id TEXT
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
    shared_shift_id      TEXT,
    delegation_imported_at TEXT,
    delegation_cleanup_pending INTEGER NOT NULL DEFAULT 0,
    delegation_version INTEGER,
    delegation_source_transfer_id TEXT,
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
    protocol_event_id TEXT,
    protocol_shift_id TEXT,
    protocol_seq INTEGER,
    protocol_sender_role TEXT,
    protocol_recorded_at TEXT,
    protocol_applied_at TEXT,
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
    protocol_state    TEXT NOT NULL DEFAULT 'draft',
    transfer_id       TEXT,
    shift_version     INTEGER NOT NULL DEFAULT 1,
    session_id        TEXT,
    primary_device_id TEXT,
    alternate_device_id TEXT,
    primary_identity_key TEXT,
    alternate_identity_key TEXT,
    primary_ephemeral_key TEXT,
    alternate_ephemeral_key TEXT,
    invite_nonce      TEXT,
    accepted_at       TEXT,
    activated_at      TEXT,
    return_requested_at TEXT,
    return_acked_at   TEXT,
    cleanup_completed_at TEXT,
    final_seq         INTEGER,
    last_applied_seq  INTEGER NOT NULL DEFAULT 0,
    confirmation_code TEXT NOT NULL,
    notes             TEXT,
    cancel_reason     TEXT,
    primary_phone     TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS native_alarms (
    alarm_id TEXT PRIMARY KEY,
    med_id   TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS refill_events (
    id TEXT PRIMARY KEY,
    protocol_event_id TEXT NOT NULL UNIQUE,
    shift_id TEXT NOT NULL,
    medication_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    refill_date TEXT NOT NULL,
    days_supply INTEGER,
    unit TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS protocol_message_receipts (
    id TEXT PRIMARY KEY,
    shift_id TEXT NOT NULL,
    message_type TEXT NOT NULL,
    nonce TEXT NOT NULL UNIQUE,
    sender_identity_key TEXT NOT NULL,
    received_at TEXT NOT NULL,
    expires_at TEXT,
    signature_valid INTEGER NOT NULL,
    status TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS protocol_event_receipts (
    protocol_event_id TEXT PRIMARY KEY,
    shift_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    received_at TEXT NOT NULL,
    applied_at TEXT,
    status TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS device_identity (
    device_id TEXT PRIMARY KEY,
    encryption_public_key TEXT NOT NULL,
    encryption_private_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  inner.executeSync(`CREATE TABLE IF NOT EXISTS shift_peer_keys (
    shift_id TEXT PRIMARY KEY,
    peer_role TEXT NOT NULL,
    peer_identity_key TEXT NOT NULL,
    peer_ephemeral_key TEXT,
    established_at TEXT
  )`);

}

function insertDefaultSettings(inner: DB): void {
  const defaults: [string, string][] = [
    ['early_window_minutes',  '30'],
    ['missed_window_minutes', '60'],
    ['global_missed_policy',  'none'],
    ['refill_alert_days',     '7'],
    ['alarm_type',                   'sound,vibration'],
    ['inactivity_timeout_minutes',   '0'],
    ['flag_secure',                  'false'],
    ['primary_name',                 'Primary Caregiver'],
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
  addCol('medications', 'rxcui',                'TEXT');
  addCol('medications', 'drug_info',            'TEXT');
  addCol('medications', 'pill_appearance',      'TEXT');
  addCol('medications', 'missed_window_minutes', 'INTEGER');
  addCol('medications', 'shared_shift_id', 'TEXT');
  addCol('medications', 'delegation_imported_at', 'TEXT');
  addCol('medications', 'delegation_cleanup_pending', 'INTEGER NOT NULL DEFAULT 0');
  addCol('medications', 'delegation_version', 'INTEGER');
  addCol('medications', 'delegation_source_transfer_id', 'TEXT');
  addCol('dose_logs',   'caregiver_id',         'TEXT');
  addCol('dose_logs',   'protocol_event_id',    'TEXT');
  addCol('dose_logs',   'protocol_shift_id',    'TEXT');
  addCol('dose_logs',   'protocol_seq',         'INTEGER');
  addCol('dose_logs',   'protocol_sender_role', 'TEXT');
  addCol('dose_logs',   'protocol_recorded_at', 'TEXT');
  addCol('dose_logs',   'protocol_applied_at',  'TEXT');
  addCol('entities',    'delegation_owner_device_id', 'TEXT');
  addCol('entities',    'delegation_imported_at', 'TEXT');
  addCol('entities',    'delegation_expires_at', 'TEXT');
  addCol('entities',    'delegation_cleanup_pending', 'INTEGER NOT NULL DEFAULT 0');
  addCol('entities',    'delegation_version', 'INTEGER');
  addCol('entities',    'delegation_source_transfer_id', 'TEXT');
  addCol('caregiver_shifts', 'protocol_state', "TEXT NOT NULL DEFAULT 'draft'");
  addCol('caregiver_shifts', 'transfer_id', 'TEXT');
  addCol('caregiver_shifts', 'shift_version', 'INTEGER NOT NULL DEFAULT 1');
  addCol('caregiver_shifts', 'session_id', 'TEXT');
  addCol('caregiver_shifts', 'primary_device_id', 'TEXT');
  addCol('caregiver_shifts', 'alternate_device_id', 'TEXT');
  addCol('caregiver_shifts', 'primary_identity_key', 'TEXT');
  addCol('caregiver_shifts', 'alternate_identity_key', 'TEXT');
  addCol('caregiver_shifts', 'primary_ephemeral_key', 'TEXT');
  addCol('caregiver_shifts', 'alternate_ephemeral_key', 'TEXT');
  addCol('caregiver_shifts', 'invite_nonce', 'TEXT');
  addCol('caregiver_shifts', 'accepted_at', 'TEXT');
  addCol('caregiver_shifts', 'activated_at', 'TEXT');
  addCol('caregiver_shifts', 'return_requested_at', 'TEXT');
  addCol('caregiver_shifts', 'return_acked_at', 'TEXT');
  addCol('caregiver_shifts', 'cleanup_completed_at', 'TEXT');
  addCol('caregiver_shifts', 'final_seq', 'INTEGER');
  addCol('caregiver_shifts', 'last_applied_seq', 'INTEGER NOT NULL DEFAULT 0');
  addCol('caregiver_shifts', 'cancel_reason', 'TEXT');
  inner.executeSync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dose_logs_protocol_event_id
    ON dose_logs(protocol_event_id)`);

  // Incremental migrations on existing encrypted DB.
  if (currentVersion > 0) {
    if (currentVersion >= 6 && currentVersion < 9) {
      for (const [k, v] of [
        ['alarm_type', 'sound,vibration'],
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
