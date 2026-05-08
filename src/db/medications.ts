import * as Crypto from 'expo-crypto';
import { getDb } from './database';
import type { Medication } from '../types';

const uuidv4 = () => Crypto.randomUUID();

function now(): string {
  return new Date().toISOString();
}

export async function getMedications(entityId: string): Promise<Medication[]> {
  const db = getDb();
  return db.getAllAsync<Medication>(
    `SELECT * FROM medications WHERE entity_id = ? AND deleted_at IS NULL ORDER BY name ASC`,
    [entityId]
  );
}

export async function getMedication(id: string): Promise<Medication | null> {
  const db = getDb();
  return db.getFirstAsync<Medication>(
    `SELECT * FROM medications WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
}

type CreateInput = Pick<
  Medication,
  'entity_id' | 'name' | 'dosage' | 'pills_per_dose' |
  'schedule' | 'food_requirement' | 'interactions' |
  'missed_policy' | 'early_window_minutes' | 'color' | 'notes'
>;

export async function createMedication(data: CreateInput): Promise<Medication> {
  const db = getDb();
  const med: Medication = {
    id: uuidv4(),
    entity_id: data.entity_id,
    name: data.name,
    dosage: data.dosage,
    pills_per_dose: data.pills_per_dose,
    schedule: data.schedule,
    food_requirement: data.food_requirement,
    interactions: data.interactions,
    missed_policy: data.missed_policy ?? null,
    early_window_minutes: data.early_window_minutes ?? null,
    color: data.color,
    notes: data.notes ?? null,
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
  };

  await db.runAsync(
    `INSERT INTO medications
       (id, entity_id, name, dosage, pills_per_dose, schedule, food_requirement,
        interactions, missed_policy, early_window_minutes, color, notes,
        created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      med.id, med.entity_id, med.name, med.dosage, med.pills_per_dose,
      med.schedule, med.food_requirement, med.interactions,
      med.missed_policy, med.early_window_minutes,
      med.color, med.notes, med.created_at, med.updated_at, null,
    ]
  );

  return med;
}

type UpdateInput = Partial<Pick<
  Medication,
  'name' | 'dosage' | 'pills_per_dose' | 'schedule' |
  'food_requirement' | 'interactions' | 'missed_policy' |
  'early_window_minutes' | 'color' | 'notes'
>>;

export async function updateMedication(id: string, data: UpdateInput): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE medications
     SET name                 = COALESCE(?, name),
         dosage               = COALESCE(?, dosage),
         pills_per_dose       = COALESCE(?, pills_per_dose),
         schedule             = COALESCE(?, schedule),
         food_requirement     = ?,
         interactions         = COALESCE(?, interactions),
         missed_policy        = ?,
         early_window_minutes = ?,
         color                = COALESCE(?, color),
         notes                = COALESCE(?, notes),
         updated_at           = ?
     WHERE id = ?`,
    [
      data.name ?? null,
      data.dosage ?? null,
      data.pills_per_dose ?? null,
      data.schedule ?? null,
      data.food_requirement ?? null,
      data.interactions ?? null,
      data.missed_policy ?? null,
      data.early_window_minutes ?? null,
      data.color ?? null,
      data.notes ?? null,
      now(),
      id,
    ]
  );
}

export async function deleteMedication(id: string): Promise<void> {
  const db = getDb();
  const ts = now();
  await db.runAsync(
    `UPDATE medications SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    [ts, ts, id]
  );
}
