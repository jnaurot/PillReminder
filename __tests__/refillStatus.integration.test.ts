jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `uuid-${Math.random().toString(36).slice(2, 8)}`),
}));

import { getDb } from '../src/db/database';
import { getRefillStatus, logRefill } from '../src/db/prescriptions';

type Row = Record<string, any>;

class FakeDb {
  prescriptions: Row[] = [];
  doseLogs: Row[] = [];
  medications = new Map<string, Row>();

  async runAsync(sql: string, params: unknown[] = []) {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('INSERT INTO prescriptions')) {
      const [id, medication_id, refill_date, quantity, days_supply, unit, created_at] = params;
      this.prescriptions.push({
        id,
        medication_id,
        refill_date,
        quantity,
        days_supply,
        unit,
        created_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    throw new Error(`Unhandled runAsync SQL: ${sql}`);
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('SELECT * FROM prescriptions')) {
      const medicationId = params[0] as string;
      return this.prescriptions
        .filter((row) => row.medication_id === medicationId)
        .sort((a, b) =>
          String(b.refill_date).localeCompare(String(a.refill_date)) ||
          String(b.created_at).localeCompare(String(a.created_at)),
        ) as T[];
    }

    throw new Error(`Unhandled getAllAsync SQL: ${sql}`);
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('SELECT * FROM prescriptions')) {
      const medicationId = params[0] as string;
      const rows = await this.getAllAsync<Row>(sql, [medicationId]);
      return ((rows[0] ?? null) as T | null);
    }

    if (norm.startsWith('SELECT COUNT(*) as total FROM dose_logs')) {
      const [medicationId, cutoff] = params as [string, string];
      const total = this.doseLogs.filter((row) =>
        row.medication_id === medicationId &&
        row.skipped === 0 &&
        row.taken_at >= cutoff,
      ).length;
      return { total } as T;
    }

    if (norm.startsWith('SELECT pills_per_dose FROM medications WHERE id = ?')) {
      const medicationId = params[0] as string;
      return (this.medications.get(medicationId) ?? null) as T | null;
    }

    throw new Error(`Unhandled getFirstAsync SQL: ${sql}`);
  }
}

describe('refill status integration', () => {
  let fakeDb: FakeDb;

  beforeEach(() => {
    fakeDb = new FakeDb();
    fakeDb.medications.set('med-1', { pills_per_dose: 1 });
    (getDb as jest.Mock).mockReturnValue(fakeDb);
  });

  it('adds refill quantities to current supply instead of resetting to the latest refill quantity', async () => {
    await logRefill('med-1', 24, null, '2026-06-01', 'pills');
    fakeDb.doseLogs.push(
      {
        medication_id: 'med-1',
        skipped: 0,
        taken_at: '2026-06-02T08:00:00',
      },
      {
        medication_id: 'med-1',
        skipped: 0,
        taken_at: '2026-06-03T08:00:00',
      },
      {
        medication_id: 'med-1',
        skipped: 0,
        taken_at: '2026-06-04T08:00:00',
      },
    );

    await logRefill('med-1', 90, null, '2026-06-05', 'pills');

    const status = await getRefillStatus('med-1', 7);

    expect(status).not.toBeNull();
    expect(status!.prescription.quantity).toBe(90);
    expect(status!.unitsRemaining).toBe(111);
  });
});
