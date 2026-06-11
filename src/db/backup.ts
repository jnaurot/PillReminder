import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as ExpoCrypto from 'expo-crypto';
import CryptoJS from 'crypto-js';
import { getDb } from './database';

// ─── Encryption helpers (AES-256-CBC + PBKDF2) ────────────────────────────────

const ITERATIONS = 100_000;
const KEY_SIZE   = 256 / 32; // words

interface EncryptedEnvelope {
  _enc: true;
  v: 1;
  salt: string;
  iv: string;
  ct: string;
}

// crypto-js's WordArray.random() calls window.crypto which doesn't exist in RN.
// Use expo-crypto for secure random bytes instead.
function toWordArray(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      ((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) |
      ((bytes[i + 2] ?? 0) << 8)  | (bytes[i + 3] ?? 0),
    );
  }
  return CryptoJS.lib.WordArray.create(words as any, bytes.length);
}

export async function encryptBackupPayload(json: string, password: string): Promise<string> {
  const salt = toWordArray(await ExpoCrypto.getRandomBytesAsync(16));
  const iv   = toWordArray(await ExpoCrypto.getRandomBytesAsync(16));
  const key  = CryptoJS.PBKDF2(password, salt, { keySize: KEY_SIZE, iterations: ITERATIONS });
  const ct   = CryptoJS.AES.encrypt(json, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  const envelope: EncryptedEnvelope = {
    _enc: true, v: 1,
    salt: salt.toString(CryptoJS.enc.Hex),
    iv:   iv.toString(CryptoJS.enc.Hex),
    ct:   ct.toString(),
  };
  return JSON.stringify(envelope);
}

export function decryptBackupPayload(encryptedJson: string, password: string): string {
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(encryptedJson);
  } catch {
    throw new Error('Invalid backup file format.');
  }
  if (!envelope._enc) throw new Error('File is not encrypted.');
  const salt = CryptoJS.enc.Hex.parse(envelope.salt);
  const iv   = CryptoJS.enc.Hex.parse(envelope.iv);
  const key  = CryptoJS.PBKDF2(password, salt, { keySize: KEY_SIZE, iterations: ITERATIONS });
  const dec  = CryptoJS.AES.decrypt(envelope.ct, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  const json = dec.toString(CryptoJS.enc.Utf8);
  if (!json) throw new Error('Incorrect password.');
  return json;
}

function csvCell(val: string | number | null | undefined): string {
  if (val == null) return '';
  const s = String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function todayTag(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export async function exportCSV(): Promise<void> {
  const db = getDb();
  const rows = await db.getAllAsync<{
    person: string; medication: string; dosage: string;
    scheduled_at: string; taken_at: string | null;
    skipped: number; is_catchup: number; notes: string | null;
  }>(`
    SELECT e.name AS person, m.name AS medication, m.dosage,
           dl.scheduled_at, dl.taken_at, dl.skipped, dl.is_catchup, dl.notes
    FROM dose_logs dl
    JOIN medications m ON dl.medication_id = m.id
    JOIN entities e ON m.entity_id = e.id
    WHERE e.deleted_at IS NULL AND m.deleted_at IS NULL
    ORDER BY dl.scheduled_at DESC
  `);

  const header = 'Person,Medication,Dosage,Scheduled At,Taken At,Skipped,Catch-up,Notes\n';
  const body = rows.map((r) => [
    csvCell(r.person), csvCell(r.medication), csvCell(r.dosage),
    csvCell(r.scheduled_at), csvCell(r.taken_at),
    r.skipped ? 'Yes' : 'No',
    r.is_catchup ? 'Yes' : 'No',
    csvCell(r.notes),
  ].join(',')).join('\n');

  const path = `${FileSystem.cacheDirectory}pillreminder-doses-${todayTag()}.csv`;
  await FileSystem.writeAsStringAsync(path, header + body, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Dose History' });
}

// ─── JSON backup export ───────────────────────────────────────────────────────

export async function exportBackup(password: string): Promise<void> {
  const db = getDb();
  const [entities, medications, prescriptions, dose_logs, settings] = await Promise.all([
    db.getAllAsync('SELECT * FROM entities'),
    db.getAllAsync('SELECT * FROM medications'),
    db.getAllAsync('SELECT * FROM prescriptions'),
    db.getAllAsync('SELECT * FROM dose_logs'),
    db.getAllAsync('SELECT * FROM settings'),
  ]);

  const backup = {
    _app: 'PillReminder',
    _version: 1,
    exported_at: new Date().toISOString(),
    entities,
    medications,
    prescriptions,
    dose_logs,
    settings,
  };

  const encrypted = await encryptBackupPayload(JSON.stringify(backup), password);
  const path = `${FileSystem.cacheDirectory}pillreminder-backup-${todayTag()}.json`;
  await FileSystem.writeAsStringAsync(path, encrypted, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Export Backup' });
}

// ─── JSON backup import ───────────────────────────────────────────────────────

export interface ImportResult {
  entities: number;
  medications: number;
  logs: number;
}

export async function importBackup(uri: string, password: string): Promise<ImportResult> {
  const content = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });

  let parsed: any;
  try { parsed = JSON.parse(content); } catch { throw new Error('Invalid backup file format.'); }

  // Detect encrypted envelope
  const backup = parsed._enc ? JSON.parse(decryptBackupPayload(content, password)) : parsed;

  if (
    backup._app !== 'PillReminder' ||
    !Array.isArray(backup.entities) ||
    !Array.isArray(backup.medications) ||
    !Array.isArray(backup.dose_logs)
  ) {
    throw new Error('Invalid or unrecognised backup file.');
  }

  const db = getDb();

  await db.execAsync('BEGIN');
  try {
    await db.runAsync('DELETE FROM dose_logs');
    await db.runAsync('DELETE FROM prescriptions');
    await db.runAsync('DELETE FROM medications');
    await db.runAsync('DELETE FROM entities');
    await db.runAsync('DELETE FROM settings');

    for (const r of backup.entities as any[]) {
      await db.runAsync(
        `INSERT INTO entities
         (id, name, dob, notes, created_at, updated_at, deleted_at, shift_source, shared_shift_id,
          primary_phone, delegation_owner_device_id, delegation_imported_at, delegation_expires_at,
          delegation_cleanup_pending, delegation_version, delegation_source_transfer_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id,
          r.name,
          r.dob ?? null,
          r.notes ?? null,
          r.created_at,
          r.updated_at,
          r.deleted_at ?? null,
          r.shift_source ?? 'local',
          r.shared_shift_id ?? null,
          r.primary_phone ?? null,
          r.delegation_owner_device_id ?? null,
          r.delegation_imported_at ?? null,
          r.delegation_expires_at ?? null,
          r.delegation_cleanup_pending ?? 0,
          r.delegation_version ?? null,
          r.delegation_source_transfer_id ?? null,
        ],
      );
    }

    for (const r of backup.medications as any[]) {
      await db.runAsync(
        `INSERT INTO medications
         (id, entity_id, name, dosage, pills_per_dose, schedule, food_requirement,
          interactions, missed_policy, early_window_minutes, missed_window_minutes, color, notes,
          rxcui, drug_info, pill_appearance, shared_shift_id, delegation_imported_at,
          delegation_cleanup_pending, delegation_version, delegation_source_transfer_id,
          created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id,
          r.entity_id,
          r.name,
          r.dosage,
          r.pills_per_dose ?? 1,
          r.schedule ?? '{"type":"fixed_times","times":[]}',
          r.food_requirement ?? null,
          r.interactions ?? '[]',
          r.missed_policy ?? null,
          r.early_window_minutes ?? null,
          r.missed_window_minutes ?? null,
          r.color ?? '#4A90D9',
          r.notes ?? null,
          r.rxcui ?? null,
          r.drug_info ?? null,
          r.pill_appearance ?? null,
          r.shared_shift_id ?? null,
          r.delegation_imported_at ?? null,
          r.delegation_cleanup_pending ?? 0,
          r.delegation_version ?? null,
          r.delegation_source_transfer_id ?? null,
          r.created_at,
          r.updated_at,
          r.deleted_at ?? null,
        ],
      );
    }

    for (const r of (backup.prescriptions ?? []) as any[]) {
      await db.runAsync(
        `INSERT INTO prescriptions (id, medication_id, refill_date, quantity, days_supply, unit, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.medication_id, r.refill_date, r.quantity,
         r.days_supply ?? null, r.unit ?? 'pills', r.created_at],
      );
    }

    for (const r of backup.dose_logs as any[]) {
      await db.runAsync(
        `INSERT INTO dose_logs
         (id, medication_id, scheduled_at, taken_at, skipped, is_catchup, notes, caregiver_id,
          protocol_event_id, protocol_shift_id, protocol_seq, protocol_sender_role,
          protocol_recorded_at, protocol_applied_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id,
          r.medication_id,
          r.scheduled_at,
          r.taken_at ?? null,
          r.skipped ?? 0,
          r.is_catchup ?? 0,
          r.notes ?? null,
          r.caregiver_id ?? null,
          r.protocol_event_id ?? null,
          r.protocol_shift_id ?? null,
          r.protocol_seq ?? null,
          r.protocol_sender_role ?? null,
          r.protocol_recorded_at ?? null,
          r.protocol_applied_at ?? null,
          r.created_at,
        ],
      );
    }

    for (const r of (backup.settings ?? []) as any[]) {
      await db.runAsync(
        `INSERT INTO settings (key, value) VALUES (?, ?)`,
        [r.key, r.value],
      );
    }

    await db.execAsync('COMMIT');
  } catch (err) {
    await db.execAsync('ROLLBACK');
    throw err;
  }

  return {
    entities: backup.entities.length,
    medications: backup.medications.length,
    logs: backup.dose_logs.length,
  };
}
