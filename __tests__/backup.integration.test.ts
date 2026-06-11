jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
  __esModule: true,
  default: {
    shareAsync: jest.fn(),
  },
}));
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (length: number) =>
    Uint8Array.from({ length }, (_, index) => (index + 1) % 255),
  ),
}));

import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../src/db/database';
import {
  decryptBackupPayload,
  encryptBackupPayload,
  importBackup,
} from '../src/db/backup';

type Row = Record<string, any>;

class FakeDb {
  execCalls: string[] = [];
  insertedEntities: Row[] = [];
  insertedMedications: Row[] = [];
  insertedDoseLogs: Row[] = [];
  insertedPrescriptions: Row[] = [];
  insertedSettings: Row[] = [];

  async execAsync(sql: string) {
    this.execCalls.push(sql);
  }

  async runAsync(sql: string, params: unknown[] = []) {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm === 'DELETE FROM dose_logs' || norm === 'DELETE FROM prescriptions' || norm === 'DELETE FROM medications' || norm === 'DELETE FROM entities' || norm === 'DELETE FROM settings') {
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO entities')) {
      const [
        id,
        name,
        dob,
        notes,
        created_at,
        updated_at,
        deleted_at,
        shift_source,
        shared_shift_id,
        primary_phone,
        delegation_owner_device_id,
        delegation_imported_at,
        delegation_expires_at,
        delegation_cleanup_pending,
        delegation_version,
        delegation_source_transfer_id,
      ] = params;
      this.insertedEntities.push({
        id,
        name,
        dob,
        notes,
        created_at,
        updated_at,
        deleted_at,
        shift_source,
        shared_shift_id,
        primary_phone,
        delegation_owner_device_id,
        delegation_imported_at,
        delegation_expires_at,
        delegation_cleanup_pending,
        delegation_version,
        delegation_source_transfer_id,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO medications')) {
      const [
        id,
        entity_id,
        name,
        dosage,
        pills_per_dose,
        schedule,
        food_requirement,
        interactions,
        missed_policy,
        early_window_minutes,
        missed_window_minutes,
        color,
        notes,
        rxcui,
        drug_info,
        pill_appearance,
        shared_shift_id,
        delegation_imported_at,
        delegation_cleanup_pending,
        delegation_version,
        delegation_source_transfer_id,
        created_at,
        updated_at,
        deleted_at,
      ] = params;
      this.insertedMedications.push({
        id,
        entity_id,
        name,
        dosage,
        pills_per_dose,
        schedule,
        food_requirement,
        interactions,
        missed_policy,
        early_window_minutes,
        missed_window_minutes,
        color,
        notes,
        rxcui,
        drug_info,
        pill_appearance,
        shared_shift_id,
        delegation_imported_at,
        delegation_cleanup_pending,
        delegation_version,
        delegation_source_transfer_id,
        created_at,
        updated_at,
        deleted_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO prescriptions')) {
      const [id, medication_id, refill_date, quantity, unit, created_at] = params;
      this.insertedPrescriptions.push({ id, medication_id, refill_date, quantity, unit, created_at });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO dose_logs')) {
      const [
        id,
        medication_id,
        scheduled_at,
        taken_at,
        skipped,
        is_catchup,
        notes,
        caregiver_id,
        protocol_event_id,
        protocol_shift_id,
        protocol_seq,
        protocol_sender_role,
        protocol_recorded_at,
        protocol_applied_at,
        created_at,
      ] = params;
      this.insertedDoseLogs.push({
        id,
        medication_id,
        scheduled_at,
        taken_at,
        skipped,
        is_catchup,
        notes,
        caregiver_id,
        protocol_event_id,
        protocol_shift_id,
        protocol_seq,
        protocol_sender_role,
        protocol_recorded_at,
        protocol_applied_at,
        created_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm === 'INSERT INTO settings (key, value) VALUES (?, ?)') {
      const [key, value] = params;
      this.insertedSettings.push({ key, value });
      return { changes: 1, lastInsertRowId: 0 };
    }

    throw new Error(`Unhandled runAsync SQL: ${sql}`);
  }
}

describe('backup db integration', () => {
  let fakeDb: FakeDb;

  beforeEach(() => {
    fakeDb = new FakeDb();
    (getDb as jest.Mock).mockReturnValue(fakeDb);
    jest.clearAllMocks();
  });

  it('encrypts and decrypts backup payloads as a round trip', async () => {
    const encrypted = await encryptBackupPayload('{"ok":true}', 'secret-pass');

    expect(JSON.parse(encrypted)).toMatchObject({ _enc: true, v: 1 });
    expect(decryptBackupPayload(encrypted, 'secret-pass')).toBe('{"ok":true}');
  });

  it('restores enriched medication, delegated entity, and protocol log columns during import', async () => {
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(
      JSON.stringify({
        _app: 'PillReminder',
        entities: [
          {
            id: 'entity-1',
            name: 'Chris',
            dob: '1950-05-05',
            notes: 'Shared',
            created_at: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-01T00:00:00.000Z',
            deleted_at: null,
            shift_source: 'shared',
            shared_shift_id: 'shift-9',
            primary_phone: '5550001234',
            delegation_owner_device_id: 'device-1',
            delegation_imported_at: '2026-06-01T01:00:00.000Z',
            delegation_expires_at: '2026-06-02T01:00:00.000Z',
            delegation_cleanup_pending: 1,
            delegation_version: 2,
            delegation_source_transfer_id: 'transfer-1',
          },
        ],
        medications: [
          {
            id: 'med-1',
            entity_id: 'entity-1',
            name: 'Metformin',
            dosage: '500 mg',
            pills_per_dose: 2,
            schedule: '{"type":"fixed_times","times":["08:00"]}',
            food_requirement: 'with_food',
            interactions: '[]',
            missed_policy: 'catch_up',
            early_window_minutes: 20,
            missed_window_minutes: 70,
            color: '#123456',
            notes: 'Observe',
            rxcui: '860975',
            drug_info: '{"class":"biguanide"}',
            pill_appearance: '{"shape":"oval"}',
            shared_shift_id: 'shift-9',
            delegation_imported_at: '2026-06-01T01:00:00.000Z',
            delegation_cleanup_pending: 1,
            delegation_version: 2,
            delegation_source_transfer_id: 'transfer-1',
            created_at: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-01T00:00:00.000Z',
            deleted_at: null,
          },
        ],
        prescriptions: [
          {
            id: 'rx-1',
            medication_id: 'med-1',
            refill_date: '2026-06-01',
            quantity: 90,
            unit: 'pills',
            created_at: '2026-06-01T00:00:00.000Z',
          },
        ],
        dose_logs: [
          {
            id: 'log-1',
            medication_id: 'med-1',
            scheduled_at: '2026-06-11T08:00:00',
            taken_at: '2026-06-11T08:02:00',
            skipped: 0,
            is_catchup: 0,
            notes: 'ok',
            caregiver_id: 'cg-1',
            protocol_event_id: 'evt-1',
            protocol_shift_id: 'shift-9',
            protocol_seq: 3,
            protocol_sender_role: 'alternate',
            protocol_recorded_at: '2026-06-11T08:02:00',
            protocol_applied_at: '2026-06-11T08:03:00',
            created_at: '2026-06-11T08:02:00',
          },
        ],
        settings: [{ key: 'alarm_type', value: 'none' }],
      }),
    );

    const result = await importBackup('/tmp/test.json', 'unused');

    expect(result).toEqual({ entities: 1, medications: 1, logs: 1 });
    expect(fakeDb.execCalls).toEqual(['BEGIN', 'COMMIT']);
    expect(fakeDb.insertedEntities[0]).toMatchObject({
      shift_source: 'shared',
      shared_shift_id: 'shift-9',
      delegation_owner_device_id: 'device-1',
      delegation_cleanup_pending: 1,
    });
    expect(fakeDb.insertedMedications[0]).toMatchObject({
      rxcui: '860975',
      drug_info: '{"class":"biguanide"}',
      pill_appearance: '{"shape":"oval"}',
      shared_shift_id: 'shift-9',
      delegation_version: 2,
    });
    expect(fakeDb.insertedDoseLogs[0]).toMatchObject({
      caregiver_id: 'cg-1',
      protocol_event_id: 'evt-1',
      protocol_shift_id: 'shift-9',
      protocol_seq: 3,
      protocol_sender_role: 'alternate',
    });
    expect(fakeDb.insertedSettings).toEqual([{ key: 'alarm_type', value: 'none' }]);
  });
});
