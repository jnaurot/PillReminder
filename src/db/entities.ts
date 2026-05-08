import * as Crypto from 'expo-crypto';
const uuidv4 = () => Crypto.randomUUID();
import { getDb } from './database';
import type { Entity } from '../types';

function now(): string {
  return new Date().toISOString();
}

export async function getEntities(): Promise<Entity[]> {
  const db = getDb();
  return db.getAllAsync<Entity>(
    `SELECT * FROM entities WHERE deleted_at IS NULL ORDER BY name ASC`
  );
}

export async function getEntity(id: string): Promise<Entity | null> {
  const db = getDb();
  return db.getFirstAsync<Entity>(
    `SELECT * FROM entities WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
}

export async function createEntity(
  data: Pick<Entity, 'name' | 'dob' | 'notes'>
): Promise<Entity> {
  const db = getDb();
  const entity: Entity = {
    id: uuidv4(),
    name: data.name,
    dob: data.dob ?? null,
    notes: data.notes ?? null,
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
  };

  await db.runAsync(
    `INSERT INTO entities (id, name, dob, notes, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entity.id, entity.name, entity.dob, entity.notes, entity.created_at, entity.updated_at, null]
  );

  return entity;
}

export async function updateEntity(
  id: string,
  data: Partial<Pick<Entity, 'name' | 'dob' | 'notes'>>
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE entities SET name = COALESCE(?, name), dob = COALESCE(?, dob),
     notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
    [data.name ?? null, data.dob ?? null, data.notes ?? null, now(), id]
  );
}

export async function deleteEntity(id: string): Promise<void> {
  const db = getDb();
  const ts = now();
  await db.runAsync(
    `UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    [ts, ts, id]
  );
  await db.runAsync(
    `UPDATE medications SET deleted_at = ?, updated_at = ? WHERE entity_id = ? AND deleted_at IS NULL`,
    [ts, ts, id]
  );
}
