jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('expo-crypto', () => {
  let nextId = 1;
  return {
    randomUUID: jest.fn(() => `med-uuid-${nextId++}`),
  };
});

import { getDb } from '../src/db/database';
import {
  createMedication,
  deleteMedication,
  eraseAndDeleteMedication,
  getDeletedMedications,
  getMedication,
  getMedications,
  getUnenrichedMedications,
  updateMedication,
  updateMedicationRxInfo,
} from '../src/db/medications';

type Row = Record<string, any>;

class FakeDb {
  medications = new Map<string, Row>();
  doseLogs: Row[] = [];
  prescriptions: Row[] = [];
  runCalls = 0;

  async runAsync(sql: string, params: unknown[] = []) {
    this.runCalls += 1;
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('INSERT INTO medications')) {
      const [
        id, entity_id, name, dosage, pills_per_dose, schedule, food_requirement,
        interactions, missed_policy, early_window_minutes, missed_window_minutes,
        color, notes, rxcui, drug_info, pill_appearance, created_at, updated_at, deleted_at,
      ] = params;
      this.medications.set(id as string, {
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
        created_at,
        updated_at,
        deleted_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE medications SET name = COALESCE')) {
      const [
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
        updated_at,
        id,
      ] = params;
      const row = this.requireMedication(id as string);
      row.name = name ?? row.name;
      row.dosage = dosage ?? row.dosage;
      row.pills_per_dose = pills_per_dose ?? row.pills_per_dose;
      row.schedule = schedule ?? row.schedule;
      row.food_requirement = food_requirement;
      row.interactions = interactions ?? row.interactions;
      row.missed_policy = missed_policy;
      row.early_window_minutes = early_window_minutes;
      row.missed_window_minutes = missed_window_minutes;
      row.color = color ?? row.color;
      row.notes = notes ?? row.notes;
      row.updated_at = updated_at;
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE medications SET rxcui = ?')) {
      const [rxcui, drug_info, updated_at, id] = params;
      const row = this.requireMedication(id as string);
      row.rxcui = rxcui;
      row.drug_info = drug_info;
      row.updated_at = updated_at;
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE medications SET pill_appearance = ?')) {
      const [pill_appearance, updated_at, id] = params;
      const row = this.requireMedication(id as string);
      row.pill_appearance = pill_appearance;
      row.updated_at = updated_at;
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE medications SET deleted_at = ?')) {
      const [deleted_at, updated_at, id] = params;
      const row = this.requireMedication(id as string);
      row.deleted_at = deleted_at;
      row.updated_at = updated_at;
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm === 'DELETE FROM dose_logs WHERE medication_id = ?') {
      this.doseLogs = this.doseLogs.filter((row) => row.medication_id !== params[0]);
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm === 'DELETE FROM prescriptions WHERE medication_id = ?') {
      this.prescriptions = this.prescriptions.filter((row) => row.medication_id !== params[0]);
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm === 'DELETE FROM medications WHERE id = ?') {
      this.medications.delete(params[0] as string);
      return { changes: 1, lastInsertRowId: 0 };
    }

    throw new Error(`Unhandled runAsync SQL: ${sql}`);
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm === 'SELECT * FROM medications WHERE entity_id = ? AND deleted_at IS NULL ORDER BY name ASC') {
      return [...this.medications.values()]
        .filter((row) => row.entity_id === params[0] && row.deleted_at == null)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))) as T[];
    }

    if (norm === 'SELECT * FROM medications WHERE entity_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC') {
      return [...this.medications.values()]
        .filter((row) => row.entity_id === params[0] && row.deleted_at != null)
        .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at))) as T[];
    }

    if (norm === 'SELECT id, name, entity_id FROM medications WHERE rxcui IS NULL AND deleted_at IS NULL') {
      return [...this.medications.values()]
        .filter((row) => row.rxcui == null && row.deleted_at == null)
        .map((row) => ({ id: row.id, name: row.name, entity_id: row.entity_id })) as T[];
    }

    throw new Error(`Unhandled getAllAsync SQL: ${sql}`);
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm === 'SELECT * FROM medications WHERE id = ?') {
      return ((this.medications.get(params[0] as string) ?? null) as T | null);
    }

    throw new Error(`Unhandled getFirstAsync SQL: ${sql}`);
  }

  private requireMedication(id: string) {
    const row = this.medications.get(id);
    if (!row) throw new Error(`Missing medication ${id}`);
    return row;
  }
}

describe('medications db integration', () => {
  let fakeDb: FakeDb;

  beforeEach(() => {
    fakeDb = new FakeDb();
    (getDb as jest.Mock).mockReturnValue(fakeDb);
  });

  it('creates medications with null enrichment fields and lists only active unenriched rows', async () => {
    fakeDb.medications.set('deleted-med', {
      id: 'deleted-med',
      entity_id: 'entity-1',
      name: 'Zeta',
      rxcui: null,
      deleted_at: '2026-06-01T00:00:00.000Z',
    });

    const med = await createMedication({
      entity_id: 'entity-1',
      name: 'Aspirin',
      dosage: '81 mg',
      pills_per_dose: 1,
      schedule: '{"type":"fixed_times","times":["08:00"]}',
      food_requirement: null,
      interactions: '[]',
      missed_policy: null,
      early_window_minutes: null,
      missed_window_minutes: null,
      color: '#ffffff',
      notes: null,
    });

    expect(med.rxcui).toBeNull();
    expect(med.drug_info).toBeNull();
    expect(med.pill_appearance).toBeNull();

    await expect(getMedication(med.id)).resolves.toMatchObject({ id: med.id, name: 'Aspirin' });
    await expect(getMedications('entity-1')).resolves.toHaveLength(1);
    await expect(getUnenrichedMedications()).resolves.toEqual([
      { id: med.id, name: 'Aspirin', entity_id: 'entity-1' },
    ]);
  });

  it('updates nullable scheduling fields and supports partial rx enrichment updates without a spurious write', async () => {
    fakeDb.medications.set('med-1', {
      id: 'med-1',
      entity_id: 'entity-1',
      name: 'Lisinopril',
      dosage: '10 mg',
      pills_per_dose: 1,
      schedule: '{"type":"fixed_times","times":["09:00"]}',
      food_requirement: 'with_food',
      interactions: '[]',
      missed_policy: 'none',
      early_window_minutes: 15,
      missed_window_minutes: 60,
      color: '#00ff00',
      notes: 'Take in morning',
      rxcui: null,
      drug_info: null,
      pill_appearance: null,
      deleted_at: null,
      updated_at: '2026-06-01T00:00:00.000Z',
    });

    const runCallsBeforeNoop = fakeDb.runCalls;
    await updateMedicationRxInfo('med-1', {});
    expect(fakeDb.runCalls).toBe(runCallsBeforeNoop);

    await updateMedication('med-1', {
      food_requirement: null,
      missed_policy: null,
      early_window_minutes: null,
      missed_window_minutes: null,
    });
    await updateMedicationRxInfo('med-1', {
      rxcui: '12345',
      drug_info: '{"name":"Lisinopril"}',
    });
    await updateMedicationRxInfo('med-1', {
      pill_appearance: '{"shape":"round"}',
    });

    expect(fakeDb.medications.get('med-1')).toMatchObject({
      food_requirement: null,
      missed_policy: null,
      early_window_minutes: null,
      missed_window_minutes: null,
      rxcui: '12345',
      drug_info: '{"name":"Lisinopril"}',
      pill_appearance: '{"shape":"round"}',
    });
  });

  it('soft-deletes medications, returns deleted rows newest first, and can erase related history permanently', async () => {
    fakeDb.medications.set('med-1', {
      id: 'med-1',
      entity_id: 'entity-1',
      name: 'Alpha',
      deleted_at: null,
      updated_at: '2026-06-01T00:00:00.000Z',
      rxcui: null,
    });
    fakeDb.medications.set('med-2', {
      id: 'med-2',
      entity_id: 'entity-1',
      name: 'Beta',
      deleted_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
      rxcui: null,
    });
    fakeDb.doseLogs.push({ id: 'log-1', medication_id: 'med-1' }, { id: 'log-2', medication_id: 'other' });
    fakeDb.prescriptions.push({ id: 'rx-1', medication_id: 'med-1' }, { id: 'rx-2', medication_id: 'other' });

    await deleteMedication('med-1');

    const deleted = await getDeletedMedications('entity-1');
    expect(deleted.map((row) => row.id)).toEqual(['med-1', 'med-2']);

    await eraseAndDeleteMedication('med-1');

    expect(fakeDb.medications.has('med-1')).toBe(false);
    expect(fakeDb.doseLogs).toEqual([{ id: 'log-2', medication_id: 'other' }]);
    expect(fakeDb.prescriptions).toEqual([{ id: 'rx-2', medication_id: 'other' }]);
  });
});
