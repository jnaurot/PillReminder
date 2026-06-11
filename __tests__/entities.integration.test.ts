jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('expo-crypto', () => {
  let nextId = 1;
  return {
    randomUUID: jest.fn(() => `entity-uuid-${nextId++}`),
  };
});

import { getDb } from '../src/db/database';
import {
  createEntity,
  deleteEntity,
  getEntities,
  getEntity,
  updateEntity,
} from '../src/db/entities';

type Row = Record<string, any>;

class FakeDb {
  entities = new Map<string, Row>();
  medications = new Map<string, Row>();

  async runAsync(sql: string, params: unknown[] = []) {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('INSERT INTO entities')) {
      const [id, name, dob, notes, created_at, updated_at, deleted_at] = params;
      this.entities.set(id as string, { id, name, dob, notes, created_at, updated_at, deleted_at });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE entities SET name = COALESCE')) {
      const [name, dob, notes, updated_at, id] = params;
      const row = this.requireEntity(id as string);
      row.name = name ?? row.name;
      row.dob = dob ?? row.dob;
      row.notes = notes ?? row.notes;
      row.updated_at = updated_at;
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE entities SET deleted_at = ?')) {
      const [deleted_at, updated_at, id] = params;
      const row = this.requireEntity(id as string);
      row.deleted_at = deleted_at;
      row.updated_at = updated_at;
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE medications SET deleted_at = ?')) {
      const [deleted_at, updated_at, entity_id] = params;
      for (const row of this.medications.values()) {
        if (row.entity_id === entity_id && row.deleted_at == null) {
          row.deleted_at = deleted_at;
          row.updated_at = updated_at;
        }
      }
      return { changes: 1, lastInsertRowId: 0 };
    }

    throw new Error(`Unhandled runAsync SQL: ${sql}`);
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm === 'SELECT * FROM entities WHERE deleted_at IS NULL ORDER BY name ASC') {
      return [...this.entities.values()]
        .filter((row) => row.deleted_at == null)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))) as T[];
    }

    throw new Error(`Unhandled getAllAsync SQL: ${sql}`);
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm === 'SELECT * FROM entities WHERE id = ? AND deleted_at IS NULL') {
      const row = this.entities.get(params[0] as string) ?? null;
      return ((row && row.deleted_at == null ? row : null) as T | null);
    }

    throw new Error(`Unhandled getFirstAsync SQL: ${sql}`);
  }

  private requireEntity(id: string) {
    const row = this.entities.get(id);
    if (!row) throw new Error(`Missing entity ${id}`);
    return row;
  }
}

describe('entities db integration', () => {
  let fakeDb: FakeDb;

  beforeEach(() => {
    fakeDb = new FakeDb();
    (getDb as jest.Mock).mockReturnValue(fakeDb);
  });

  it('creates entities with nullable fields and returns only active entities in name order', async () => {
    fakeDb.entities.set('deleted-1', {
      id: 'deleted-1',
      name: 'Zed',
      dob: null,
      notes: null,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
      deleted_at: '2026-06-03T00:00:00.000Z',
    });

    const first = await createEntity({ name: 'Maya', dob: null, notes: null });
    const second = await createEntity({ name: 'Alex', dob: '1951-10-02', notes: 'Needs water' });

    expect(first.dob).toBeNull();
    expect(first.notes).toBeNull();

    await expect(getEntity(second.id)).resolves.toMatchObject({
      id: second.id,
      name: 'Alex',
      dob: '1951-10-02',
      notes: 'Needs water',
    });

    await expect(getEntities()).resolves.toMatchObject([
      { id: second.id, name: 'Alex' },
      { id: first.id, name: 'Maya' },
    ]);
  });

  it('updates only provided entity fields and soft-deletes active medications when an entity is deleted', async () => {
    fakeDb.entities.set('entity-1', {
      id: 'entity-1',
      name: 'Jordan',
      dob: '1949-01-01',
      notes: 'Original note',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
      deleted_at: null,
    });
    fakeDb.medications.set('med-active', {
      id: 'med-active',
      entity_id: 'entity-1',
      name: 'Alpha',
      deleted_at: null,
      updated_at: '2026-06-01T00:00:00.000Z',
    });
    fakeDb.medications.set('med-deleted', {
      id: 'med-deleted',
      entity_id: 'entity-1',
      name: 'Beta',
      deleted_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
    });

    await updateEntity('entity-1', { notes: 'Updated note' });

    expect(fakeDb.entities.get('entity-1')).toMatchObject({
      name: 'Jordan',
      dob: '1949-01-01',
      notes: 'Updated note',
    });

    await deleteEntity('entity-1');

    expect(fakeDb.entities.get('entity-1')?.deleted_at).not.toBeNull();
    expect(fakeDb.medications.get('med-active')?.deleted_at).not.toBeNull();
    expect(fakeDb.medications.get('med-deleted')?.deleted_at).toBe('2026-05-01T00:00:00.000Z');
    await expect(getEntity('entity-1')).resolves.toBeNull();
  });
});
