jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/db/medications', () => ({ getMedications: jest.fn() }));
jest.mock('expo-crypto', () => {
  let nextId = 1;
  return {
    randomUUID: jest.fn(() => `cg-uuid-${nextId++}`),
  };
});

import { getDb } from '../src/db/database';
import { getMedications } from '../src/db/medications';
import {
  buildHandbackSMS,
  buildInvitePayload,
  buildInviteSMS,
  createShift,
  deleteSharedShiftData,
  getActiveShift,
  getRecentShifts,
  upsertCaregiver,
} from '../src/db/caregivers';

type Row = Record<string, any>;

class FakeDb {
  caregivers = new Map<string, Row>();
  shifts = new Map<string, Row>();
  entities = new Map<string, Row>();
  medications = new Map<string, Row>();
  doseLogs: Row[] = [];

  async runAsync(sql: string, params: unknown[] = []) {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm === 'UPDATE caregivers SET name = ? WHERE id = ?') {
      const row = this.requireCaregiver(params[1] as string);
      row.name = params[0];
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm === 'INSERT INTO caregivers (id, name, phone, created_at) VALUES (?, ?, ?, ?)') {
      const [id, name, phone, created_at] = params;
      this.caregivers.set(id as string, { id, name, phone, created_at });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO caregiver_shifts')) {
      const [id, caregiver_id, entity_ids, start_time, end_time, status, confirmation_code, notes, created_at] = params;
      this.shifts.set(id as string, {
        id,
        caregiver_id,
        entity_ids,
        start_time,
        end_time,
        status,
        confirmation_code,
        notes,
        primary_phone: '',
        protocol_state: 'draft',
        transfer_id: null,
        shift_version: 1,
        session_id: null,
        final_seq: null,
        last_applied_seq: 0,
        created_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('DELETE FROM dose_logs WHERE medication_id IN')) {
      const shiftId = params[0];
      const entityIds = [...this.entities.values()]
        .filter((row) => row.shared_shift_id === shiftId)
        .map((row) => row.id);
      const medIds = [...this.medications.values()]
        .filter((row) => entityIds.includes(row.entity_id))
        .map((row) => row.id);
      this.doseLogs = this.doseLogs.filter((row) => !medIds.includes(row.medication_id));
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('DELETE FROM medications WHERE entity_id IN')) {
      const entityIds = [...this.entities.values()]
        .filter((row) => row.shared_shift_id === params[0])
        .map((row) => row.id);
      for (const [id, row] of this.medications.entries()) {
        if (entityIds.includes(row.entity_id)) this.medications.delete(id);
      }
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm === 'DELETE FROM entities WHERE shared_shift_id = ?') {
      for (const [id, row] of this.entities.entries()) {
        if (row.shared_shift_id === params[0]) this.entities.delete(id);
      }
      return { changes: 1, lastInsertRowId: 0 };
    }

    throw new Error(`Unhandled runAsync SQL: ${sql}`);
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('SELECT s.*, c.name AS cg_name')) {
      const limit = params[0] as number;
      return [...this.shifts.values()]
        .filter((row) => row.status === 'completed' || row.status === 'cancelled')
        .sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)))
        .slice(0, limit)
        .map((row) => this.joinShift(row)) as T[];
    }

    throw new Error(`Unhandled getAllAsync SQL: ${sql}`);
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm === 'SELECT * FROM caregivers WHERE phone = ?') {
      const row = [...this.caregivers.values()].find((caregiver) => caregiver.phone === params[0]) ?? null;
      return (row as T | null);
    }

    if (norm.startsWith('SELECT s.*, c.name AS cg_name')) {
      const [nowStr] = params as [string, string];
      const row = [...this.shifts.values()]
        .filter((shift) =>
          (shift.status === 'confirmed' || shift.status === 'active') &&
          shift.start_time <= nowStr &&
          shift.end_time >= nowStr,
        )
        .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))[0] ?? null;
      return ((row ? this.joinShift(row) : null) as T | null);
    }

    throw new Error(`Unhandled getFirstAsync SQL: ${sql}`);
  }

  private joinShift(row: Row) {
    const caregiver = this.requireCaregiver(row.caregiver_id);
    return {
      ...row,
      cg_name: caregiver.name,
      cg_phone: caregiver.phone,
      cg_ca: caregiver.created_at,
    };
  }

  private requireCaregiver(id: string) {
    const row = this.caregivers.get(id);
    if (!row) throw new Error(`Missing caregiver ${id}`);
    return row;
  }
}

describe('caregivers db integration', () => {
  let fakeDb: FakeDb;

  beforeEach(() => {
    fakeDb = new FakeDb();
    (getDb as jest.Mock).mockReturnValue(fakeDb);
    (getMedications as jest.Mock).mockReset();
  });

  it('upserts caregivers by phone and creates all-entity shifts with wildcard coverage', async () => {
    const first = await upsertCaregiver('Avery', '5551112222');
    const second = await upsertCaregiver('Avery Updated', '5551112222');
    const shift = await createShift(
      second.id,
      [],
      '2026-06-11T08:00:00.000Z',
      '2026-06-11T16:00:00.000Z',
      'Day shift',
    );

    expect(first.id).toBe(second.id);
    expect(fakeDb.caregivers.get(second.id)?.name).toBe('Avery Updated');
    expect(shift.entity_ids).toBe('["*"]');
    expect(shift.notes).toBe('Day shift');
  });

  it('resolves active and recent shifts with caregiver metadata attached', async () => {
    fakeDb.caregivers.set('cg-1', {
      id: 'cg-1',
      name: 'Riley',
      phone: '5553334444',
      created_at: '2026-06-01T00:00:00.000Z',
    });
    fakeDb.shifts.set('shift-active', {
      id: 'shift-active',
      caregiver_id: 'cg-1',
      entity_ids: '["entity-1"]',
      start_time: '2026-06-10T00:00:00.000Z',
      end_time: '2026-06-12T00:00:00.000Z',
      status: 'confirmed',
      confirmation_code: 'ABC123',
      notes: null,
      primary_phone: '',
      protocol_state: 'draft',
      created_at: '2026-06-01T00:00:00.000Z',
    });
    fakeDb.shifts.set('shift-complete', {
      id: 'shift-complete',
      caregiver_id: 'cg-1',
      entity_ids: '["entity-1"]',
      start_time: '2026-06-01T00:00:00.000Z',
      end_time: '2026-06-02T00:00:00.000Z',
      status: 'completed',
      confirmation_code: 'XYZ789',
      notes: null,
      primary_phone: '',
      protocol_state: 'completed',
      created_at: '2026-06-01T00:00:00.000Z',
    });

    const active = await getActiveShift();
    const recent = await getRecentShifts(5);

    expect(active).toMatchObject({
      id: 'shift-active',
      caregiver: { id: 'cg-1', name: 'Riley' },
      resolvedStatus: 'active',
    });
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      id: 'shift-complete',
      caregiver: { phone: '5553334444' },
      resolvedStatus: 'completed',
    });
  });

  it('builds invite payloads and cleans up shared shift data without leaving imported rows behind', async () => {
    const caregiver = { id: 'cg-1', name: 'Morgan', phone: '5557779999', created_at: '2026-06-01T00:00:00.000Z' };
    const shift = {
      id: 'shift-1',
      caregiver_id: caregiver.id,
      entity_ids: '["entity-1"]',
      start_time: '2026-06-11T08:00:00.000Z',
      end_time: '2026-06-11T16:00:00.000Z',
      status: 'pending',
      confirmation_code: 'HELLO1',
      notes: 'Bring water',
      primary_phone: '',
      protocol_state: 'draft',
      transfer_id: null,
      shift_version: 1,
      session_id: null,
      final_seq: null,
      last_applied_seq: 0,
      created_at: '2026-06-01T00:00:00.000Z',
    };
    (getMedications as jest.Mock).mockResolvedValue([
      {
        id: 'med-1',
        entity_id: 'entity-1',
        name: 'Warfarin',
        dosage: '5 mg',
        pills_per_dose: 1,
        schedule: '{"type":"fixed_times","times":["09:00"]}',
        food_requirement: null,
        interactions: '[]',
        missed_policy: null,
        early_window_minutes: 30,
        missed_window_minutes: 60,
        color: '#111111',
        notes: 'Take carefully',
      },
    ]);

    const payload = await buildInvitePayload(shift as any, '5550001111', [
      { id: 'entity-1', name: 'Pat Lee', dob: '1948-04-20', notes: 'Fall risk' },
    ]);

    expect(payload.entities).toEqual([
      { id: 'entity-1', name: 'Pat Lee', dob: '1948-04-20', notes: 'Fall risk' },
    ]);
    expect(payload.medications).toEqual([
      expect.objectContaining({
        id: 'med-1',
        entityId: 'entity-1',
        name: 'Warfarin',
        color: '#111111',
      }),
    ]);
    expect(buildInviteSMS(caregiver, ['Pat Lee'], shift as any)).toContain('CARE-HELLO1');
    expect(buildHandbackSMS(caregiver, ['Pat Lee'])).toContain('has ended');

    fakeDb.entities.set('entity-1', { id: 'entity-1', shared_shift_id: 'shift-1' });
    fakeDb.entities.set('entity-2', { id: 'entity-2', shared_shift_id: 'other-shift' });
    fakeDb.medications.set('med-1', { id: 'med-1', entity_id: 'entity-1' });
    fakeDb.medications.set('med-2', { id: 'med-2', entity_id: 'entity-2' });
    fakeDb.doseLogs = [
      { id: 'log-1', medication_id: 'med-1' },
      { id: 'log-2', medication_id: 'med-2' },
    ];

    await deleteSharedShiftData('shift-1');

    expect(fakeDb.entities.has('entity-1')).toBe(false);
    expect(fakeDb.entities.has('entity-2')).toBe(true);
    expect(fakeDb.medications.has('med-1')).toBe(false);
    expect(fakeDb.medications.has('med-2')).toBe(true);
    expect(fakeDb.doseLogs).toEqual([{ id: 'log-2', medication_id: 'med-2' }]);
  });
});
