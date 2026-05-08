import * as Crypto from 'expo-crypto';
import { getDb } from './database';
import { getMedications } from './medications';
import type { MsgShiftInvite, MsgEntity, MsgMedication } from '../messaging/types';
import { MSG_VERSION } from '../messaging/types';

const uuidv4 = () => Crypto.randomUUID();
const now = () => new Date().toISOString();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Caregiver {
  id: string;
  name: string;
  phone: string;
  created_at: string;
}

export type ShiftStatus = 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled';

export interface CaregiverShift {
  id: string;
  caregiver_id: string;
  entity_ids: string;       // JSON: string[] — entity IDs, or ["*"] for all
  start_time: string;
  end_time: string;
  status: ShiftStatus;
  confirmation_code: string;
  notes: string | null;
  primary_phone: string;    // non-empty only on the caregiver's device
  created_at: string;
}

export interface ShiftWithCaregiver extends CaregiverShift {
  caregiver: Caregiver;
  // Resolved status accounting for current time
  resolvedStatus: ShiftStatus;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveStatus(shift: CaregiverShift): ShiftStatus {
  if (shift.status === 'cancelled' || shift.status === 'completed') return shift.status;
  const nowStr = new Date().toISOString();
  if (shift.status === 'confirmed' || shift.status === 'active') {
    if (nowStr > shift.end_time) return 'completed';
    if (nowStr >= shift.start_time) return 'active';
  }
  return shift.status;
}

function mapRow(row: any): ShiftWithCaregiver {
  const shift: CaregiverShift = {
    id: row.id,
    caregiver_id: row.caregiver_id,
    entity_ids: row.entity_ids,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    confirmation_code: row.confirmation_code,
    notes: row.notes ?? null,
    primary_phone: row.primary_phone ?? '',
    created_at: row.created_at,
  };
  return {
    ...shift,
    caregiver: { id: row.caregiver_id, name: row.cg_name, phone: row.cg_phone, created_at: row.cg_ca },
    resolvedStatus: resolveStatus(shift),
  };
}

const JOIN = `
  SELECT s.*, c.name AS cg_name, c.phone AS cg_phone, c.created_at AS cg_ca
  FROM caregiver_shifts s
  JOIN caregivers c ON s.caregiver_id = c.id
`;

// ─── Caregivers ───────────────────────────────────────────────────────────────

export async function getCaregivers(): Promise<Caregiver[]> {
  return getDb().getAllAsync<Caregiver>('SELECT * FROM caregivers ORDER BY name ASC');
}

export async function upsertCaregiver(name: string, phone: string): Promise<Caregiver> {
  const db = getDb();
  const existing = await db.getFirstAsync<Caregiver>(
    'SELECT * FROM caregivers WHERE phone = ?', [phone]
  );
  if (existing) {
    await db.runAsync('UPDATE caregivers SET name = ? WHERE id = ?', [name, existing.id]);
    return { ...existing, name };
  }
  const cg: Caregiver = { id: uuidv4(), name, phone, created_at: now() };
  await db.runAsync(
    'INSERT INTO caregivers (id, name, phone, created_at) VALUES (?, ?, ?, ?)',
    [cg.id, cg.name, cg.phone, cg.created_at]
  );
  return cg;
}

export async function deleteCaregiver(id: string): Promise<void> {
  await getDb().runAsync('DELETE FROM caregivers WHERE id = ?', [id]);
}

// ─── Shifts ───────────────────────────────────────────────────────────────────

export async function createShift(
  caregiverId: string,
  entityIds: string[],  // empty = all
  startTime: string,
  endTime: string,
  notes?: string,
): Promise<CaregiverShift> {
  const db = getDb();
  const shift: CaregiverShift = {
    id: uuidv4(),
    caregiver_id: caregiverId,
    entity_ids: JSON.stringify(entityIds.length === 0 ? ['*'] : entityIds),
    start_time: startTime,
    end_time: endTime,
    status: 'pending',
    confirmation_code: generateCode(),
    notes: notes ?? null,
    primary_phone: '',
    created_at: now(),
  };
  await db.runAsync(
    `INSERT INTO caregiver_shifts
     (id, caregiver_id, entity_ids, start_time, end_time, status, confirmation_code, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [shift.id, shift.caregiver_id, shift.entity_ids, shift.start_time, shift.end_time,
     shift.status, shift.confirmation_code, shift.notes, shift.created_at],
  );
  return shift;
}

export async function confirmShift(id: string): Promise<void> {
  await getDb().runAsync("UPDATE caregiver_shifts SET status = 'confirmed' WHERE id = ?", [id]);
}

export async function cancelShift(id: string): Promise<void> {
  await getDb().runAsync("UPDATE caregiver_shifts SET status = 'cancelled' WHERE id = ?", [id]);
}

export async function completeShift(id: string): Promise<void> {
  await getDb().runAsync("UPDATE caregiver_shifts SET status = 'completed' WHERE id = ?", [id]);
}

export async function getActiveShift(): Promise<ShiftWithCaregiver | null> {
  const nowStr = new Date().toISOString();
  const row = await getDb().getFirstAsync<any>(
    `${JOIN}
     WHERE s.status IN ('confirmed', 'active')
       AND s.start_time <= ? AND s.end_time >= ?
     ORDER BY s.start_time ASC LIMIT 1`,
    [nowStr, nowStr],
  );
  return row ? mapRow(row) : null;
}

export async function getLiveShifts(): Promise<ShiftWithCaregiver[]> {
  const nowStr = new Date().toISOString();
  const rows = await getDb().getAllAsync<any>(
    `${JOIN}
     WHERE s.status NOT IN ('cancelled', 'completed')
        OR (s.end_time >= ? AND s.status = 'confirmed')
     ORDER BY s.start_time ASC`,
    [nowStr],
  );
  return rows.map(mapRow);
}

export async function getRecentShifts(limit = 20): Promise<ShiftWithCaregiver[]> {
  const rows = await getDb().getAllAsync<any>(
    `${JOIN}
     WHERE s.status IN ('completed', 'cancelled')
     ORDER BY s.start_time DESC LIMIT ?`,
    [limit],
  );
  return rows.map(mapRow);
}

// ─── SMS helpers ──────────────────────────────────────────────────────────────

export function buildInviteSMS(
  caregiver: Caregiver,
  entityNames: string[],
  shift: CaregiverShift,
): string {
  const who = entityNames.length === 0 || entityNames[0] === '*'
    ? 'all patients'
    : entityNames.join(', ');
  const start = new Date(shift.start_time).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const end = new Date(shift.end_time).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return (
    `Hi ${caregiver.name}, you've been asked to be the active caregiver for ${who} ` +
    `from ${start} to ${end}.\n\n` +
    `Confirmation code: CARE-${shift.confirmation_code}\n\n` +
    `Reply with the code above to confirm, then let the primary caregiver know. ` +
    `Sent via PillReminder.`
  );
}

// Removes all entities/medications imported for a shared shift (caregiver cleanup).
export async function deleteSharedShiftData(shiftId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `DELETE FROM dose_logs WHERE medication_id IN (
       SELECT m.id FROM medications m
       JOIN entities e ON m.entity_id = e.id
       WHERE e.shared_shift_id = ?
     )`,
    [shiftId],
  );
  await db.runAsync(
    `DELETE FROM medications WHERE entity_id IN (
       SELECT id FROM entities WHERE shared_shift_id = ?
     )`,
    [shiftId],
  );
  await db.runAsync('DELETE FROM entities WHERE shared_shift_id = ?', [shiftId]);
}

// Builds the full SHIFT_INVITE message payload including entity + medication
// snapshots. Callers pass the shift + the entities being delegated.
export async function buildInvitePayload(
  shift: CaregiverShift,
  primaryPhone: string,
  entities: Array<{ id: string; name: string; dob: string | null; notes: string | null }>,
): Promise<MsgShiftInvite> {
  const msgEntities: MsgEntity[] = entities.map((e) => ({
    id: e.id, name: e.name, dob: e.dob, notes: e.notes,
  }));

  const medArrays = await Promise.all(
    entities.map((e) => getMedications(e.id))
  );
  const msgMedications: MsgMedication[] = medArrays.flat().map((m) => ({
    id: m.id,
    entityId: m.entity_id,
    name: m.name,
    dosage: m.dosage,
    pillsPerDose: m.pills_per_dose,
    schedule: m.schedule,
    foodRequirement: m.food_requirement,
    interactions: m.interactions,
    missedPolicy: m.missed_policy,
    earlyWindowMinutes: m.early_window_minutes,
    color: m.color,
    notes: m.notes,
  }));

  return {
    v: MSG_VERSION,
    type: 'SHIFT_INVITE',
    shiftId: shift.id,
    confirmationCode: shift.confirmation_code,
    startTime: shift.start_time,
    endTime: shift.end_time,
    shiftNotes: shift.notes,
    primaryPhone,
    entities: msgEntities,
    medications: msgMedications,
  };
}

export function buildHandbackSMS(
  caregiver: Caregiver,
  entityNames: string[],
): string {
  const who = entityNames.length === 0 || entityNames[0] === '*'
    ? 'all patients'
    : entityNames.join(', ');
  return (
    `Hi ${caregiver.name}, your caregiver shift for ${who} has ended. ` +
    `Thank you! Responsibility has been returned to the primary caregiver. ` +
    `Sent via PillReminder.`
  );
}
