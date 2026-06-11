jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/db/medications', () => ({ getMedications: jest.fn() }));
jest.mock('../src/db/settings', () => ({ getSettings: jest.fn() }));
jest.mock('../src/db/caregivers', () => ({ getActiveShift: jest.fn() }));
jest.mock('expo-crypto', () => {
  let nextId = 1;
  return {
    randomUUID: jest.fn(() => `dose-log-${nextId++}`),
  };
});

import { getDb } from '../src/db/database';
import { getMedications } from '../src/db/medications';
import { getSettings } from '../src/db/settings';
import { getActiveShift } from '../src/db/caregivers';
import { getDosesForDate, logDoseSkipped, logDoseTaken } from '../src/db/doseLogs';

type Row = Record<string, any>;

class FakeDb {
  medications = new Map<string, Row>();
  doseLogs = new Map<string, Row>();
  entityRows = new Map<string, Row>();

  async runAsync(sql: string, params: unknown[] = []) {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('INSERT INTO dose_logs')) {
      const [id, medication_id, scheduled_at, taken_at, skipped, is_catchup, notes, caregiver_id, created_at] = params;
      this.doseLogs.set(id as string, {
        id,
        medication_id,
        scheduled_at,
        taken_at,
        skipped,
        is_catchup,
        notes,
        caregiver_id,
        created_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE dose_logs SET taken_at = ?')) {
      const [taken_at, skipped, is_catchup, caregiver_id, created_at, id] = params;
      const row = this.requireLog(id as string);
      row.taken_at = taken_at;
      row.skipped = skipped;
      row.is_catchup = is_catchup;
      row.caregiver_id = caregiver_id;
      row.created_at = created_at;
      return { changes: 1, lastInsertRowId: 0 };
    }

    throw new Error(`Unhandled runAsync SQL: ${sql}`);
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('SELECT dl.* FROM dose_logs dl JOIN medications m ON dl.medication_id = m.id WHERE m.entity_id = ? AND dl.scheduled_at LIKE ?')) {
      const [entityId, prefix] = params as [string, string];
      return [...this.doseLogs.values()]
        .filter((row) => {
          const med = this.medications.get(row.medication_id);
          return med?.entity_id === entityId && String(row.scheduled_at).startsWith(prefix.replace('%', ''));
        }) as T[];
    }

    if (norm.startsWith('SELECT dl.* FROM dose_logs dl JOIN medications m ON dl.medication_id = m.id WHERE m.entity_id = ? AND dl.taken_at LIKE ? AND dl.skipped = 0')) {
      const [entityId, prefix] = params as [string, string];
      return [...this.doseLogs.values()]
        .filter((row) => {
          const med = this.medications.get(row.medication_id);
          return med?.entity_id === entityId &&
            row.skipped === 0 &&
            String(row.taken_at ?? '').startsWith(prefix.replace('%', ''));
        }) as T[];
    }

    throw new Error(`Unhandled getAllAsync SQL: ${sql}`);
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm === 'SELECT entity_id FROM medications WHERE id = ?') {
      const row = this.medications.get(params[0] as string);
      return (row ? { entity_id: row.entity_id } : null) as T | null;
    }

    if (norm === 'SELECT * FROM dose_logs WHERE medication_id = ? AND scheduled_at = ?') {
      const [medicationId, scheduledAt] = params;
      const row = [...this.doseLogs.values()].find(
        (log) => log.medication_id === medicationId && log.scheduled_at === scheduledAt,
      ) ?? null;
      return (row as T | null);
    }

    if (norm === 'SELECT shift_source, shared_shift_id, primary_phone FROM entities WHERE id = ?') {
      return ((this.entityRows.get(params[0] as string) ?? null) as T | null);
    }

    throw new Error(`Unhandled getFirstAsync SQL: ${sql}`);
  }

  private requireLog(id: string) {
    const row = this.doseLogs.get(id);
    if (!row) throw new Error(`Missing log ${id}`);
    return row;
  }
}

describe('doseLogs db integration', () => {
  let fakeDb: FakeDb;

  beforeEach(() => {
    fakeDb = new FakeDb();
    (getDb as jest.Mock).mockReturnValue(fakeDb);
    (getSettings as jest.Mock).mockResolvedValue({
      early_window_minutes: 30,
      missed_window_minutes: 60,
      global_missed_policy: 'none',
    });
    (getActiveShift as jest.Mock).mockResolvedValue(null);
    jest.useFakeTimers().setSystemTime(new Date('2026-06-11T13:15:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('logs taken and skipped doses against the same scheduled slot without duplicating rows', async () => {
    fakeDb.medications.set('med-1', { id: 'med-1', entity_id: 'entity-1' });
    (getActiveShift as jest.Mock).mockResolvedValue({
      caregiver_id: 'cg-9',
      entity_ids: '["entity-1"]',
    });

    const first = await logDoseTaken('med-1', '2026-06-11T09:00:00');
    const skipped = await logDoseSkipped('med-1', '2026-06-11T09:00:00');

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      medication_id: 'med-1',
      scheduled_at: '2026-06-11T09:00:00',
      caregiver_id: 'cg-9',
      skipped: 0,
    });
    expect(skipped[0]).toMatchObject({
      medication_id: 'med-1',
      scheduled_at: '2026-06-11T09:00:00',
      skipped: 1,
      caregiver_id: 'cg-9',
    });
    expect(fakeDb.doseLogs.size).toBe(1);
  });

  it('builds today doses from schedule state, excluding future-created meds and settling PRN entries at their daily limit', async () => {
    fakeDb.entityRows.set('entity-1', {
      shift_source: 'local',
      shared_shift_id: null,
      primary_phone: null,
    });
    fakeDb.medications.set('med-fixed', { id: 'med-fixed', entity_id: 'entity-1' });
    fakeDb.medications.set('med-prn', { id: 'med-prn', entity_id: 'entity-1' });
    (getMedications as jest.Mock).mockResolvedValue([
      {
        id: 'med-fixed',
        entity_id: 'entity-1',
        name: 'Morning Dose',
        dosage: '5 mg',
        pills_per_dose: 1,
        schedule: '{"type":"fixed_times","times":["09:00"]}',
        food_requirement: null,
        interactions: '[]',
        missed_policy: null,
        early_window_minutes: null,
        missed_window_minutes: null,
        color: '#111111',
        notes: null,
        created_at: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'med-prn',
        entity_id: 'entity-1',
        name: 'PRN Dose',
        dosage: '1 tab',
        pills_per_dose: 1,
        schedule: '{"type":"prn","max_doses_per_day":1}',
        food_requirement: null,
        interactions: '[]',
        missed_policy: null,
        early_window_minutes: null,
        missed_window_minutes: null,
        color: '#222222',
        notes: null,
        created_at: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'med-future',
        entity_id: 'entity-1',
        name: 'Future Dose',
        dosage: '1 tab',
        pills_per_dose: 1,
        schedule: '{"type":"fixed_times","times":["12:00"]}',
        food_requirement: null,
        interactions: '[]',
        missed_policy: null,
        early_window_minutes: null,
        missed_window_minutes: null,
        color: '#333333',
        notes: null,
        created_at: '2026-06-12T16:00:00.000Z',
      },
    ]);
    fakeDb.doseLogs.set('log-1', {
      id: 'log-1',
      medication_id: 'med-prn',
      scheduled_at: '2026-06-11T07:30:00.000Z',
      taken_at: '2026-06-11T07:30:00.000Z',
      skipped: 0,
      is_catchup: 0,
      notes: null,
      caregiver_id: null,
      created_at: '2026-06-11T07:30:00.000Z',
    });

    const doses = await getDosesForDate('entity-1', '2026-06-11');

    expect(doses).toHaveLength(2);
    expect(doses.find((dose) => dose.medication.id === 'med-fixed')).toMatchObject({
      timeLabel: '09:00',
      status: 'due',
    });
    expect(doses.find((dose) => dose.medication.id === 'med-prn')).toMatchObject({
      status: 'taken',
      timeLabel: 'As needed (1/1 today — limit reached)',
    });
  });
});
