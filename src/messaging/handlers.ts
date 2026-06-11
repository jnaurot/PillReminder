import * as Crypto from 'expo-crypto';
import { getDb } from '../db/database';
import type {
  AnyMessage,
  MsgShiftInvite,
  MsgShiftAccept,
  MsgShiftDecline,
  MsgDoseUpdate,
  MsgRefillUpdate,
  MsgShiftHandback,
  MsgShiftComplete,
} from './types';

const uuidv4 = () => Crypto.randomUUID();
const now = () => new Date().toISOString();

export type HandlerResult =
  | { ok: true; action: string }
  | { ok: false; error: string };

// ─── Individual handlers ──────────────────────────────────────────────────────

async function handleShiftInvite(msg: MsgShiftInvite): Promise<HandlerResult> {
  const db = getDb();

  // Import entities with shift_source = 'shared' so the caregiver's Today
  // view shows them and DoseCard can send DOSE_UPDATE messages.
  for (const e of msg.entities) {
    await db.runAsync(
      `INSERT OR REPLACE INTO entities
         (id, name, dob, notes, shift_source, shared_shift_id, primary_phone,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 'shared', ?, ?, ?, ?)`,
      [e.id, e.name, e.dob, e.notes, msg.shiftId, msg.primaryPhone, now(), now()],
    );
  }

  // Import medications
  for (const m of msg.medications) {
    await db.runAsync(
      `INSERT OR REPLACE INTO medications
         (id, entity_id, name, dosage, pills_per_dose, schedule,
          food_requirement, interactions, missed_policy, early_window_minutes,
          color, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.id, m.entityId, m.name, m.dosage, m.pillsPerDose, m.schedule,
        m.foodRequirement, m.interactions, m.missedPolicy, m.earlyWindowMinutes,
        m.color, m.notes, now(), now(),
      ],
    );
  }

  // Create a caregivers row representing the primary (needed for FK in shift row)
  const existingCg = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM caregivers WHERE phone = ?', [msg.primaryPhone],
  );
  let primaryCgId: string;
  if (existingCg) {
    primaryCgId = existingCg.id;
  } else {
    primaryCgId = uuidv4();
    await db.runAsync(
      'INSERT INTO caregivers (id, name, phone, created_at) VALUES (?, ?, ?, ?)',
      [primaryCgId, 'Primary caregiver', msg.primaryPhone, now()],
    );
  }

  // Create a local shift record so the caregiver's device can track the shift
  // and the caregivers/index screen has something to show.
  await db.runAsync(
    `INSERT OR REPLACE INTO caregiver_shifts
       (id, caregiver_id, entity_ids, start_time, end_time, status,
        confirmation_code, notes, primary_phone, created_at)
     VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
    [
      msg.shiftId, primaryCgId,
      JSON.stringify(msg.entities.map((e) => e.id)),
      msg.startTime, msg.endTime,
      msg.confirmationCode, msg.shiftNotes,
      msg.primaryPhone, now(),
    ],
  );

  return { ok: true, action: 'shift_invite_imported' };
}

async function handleShiftAccept(msg: MsgShiftAccept): Promise<HandlerResult> {
  await getDb().runAsync(
    "UPDATE caregiver_shifts SET status = 'confirmed' WHERE id = ?",
    [msg.shiftId],
  );
  return { ok: true, action: 'shift_confirmed' };
}

async function handleShiftDecline(msg: MsgShiftDecline): Promise<HandlerResult> {
  await getDb().runAsync(
    "UPDATE caregiver_shifts SET status = 'cancelled' WHERE id = ?",
    [msg.shiftId],
  );
  return { ok: true, action: 'shift_declined' };
}

async function handleDoseUpdate(msg: MsgDoseUpdate): Promise<HandlerResult> {
  const db = getDb();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM dose_logs WHERE medication_id = ? AND scheduled_at = ?',
    [msg.medicationId, msg.scheduledAt],
  );
  if (existing) {
    await db.runAsync(
      'UPDATE dose_logs SET taken_at = ?, skipped = ?, notes = ? WHERE id = ?',
      [msg.takenAt, msg.skipped ? 1 : 0, msg.notes, existing.id],
    );
  } else {
    await db.runAsync(
      `INSERT INTO dose_logs
         (id, medication_id, scheduled_at, taken_at, skipped, is_catchup, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [uuidv4(), msg.medicationId, msg.scheduledAt, msg.takenAt,
       msg.skipped ? 1 : 0, msg.notes, now()],
    );
  }
  return { ok: true, action: 'dose_updated' };
}

async function handleRefillUpdate(msg: MsgRefillUpdate): Promise<HandlerResult> {
  await getDb().runAsync(
    `INSERT OR IGNORE INTO prescriptions
       (id, medication_id, refill_date, quantity, unit, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), msg.medicationId, msg.refillDate, msg.quantity,
     msg.unit, now()],
  );
  return { ok: true, action: 'refill_updated' };
}

async function handleShiftHandback(msg: MsgShiftHandback): Promise<HandlerResult> {
  await getDb().runAsync(
    "UPDATE caregiver_shifts SET status = 'completed' WHERE id = ?",
    [msg.shiftId],
  );
  return { ok: true, action: 'shift_handback_received' };
}

async function handleShiftComplete(msg: MsgShiftComplete): Promise<HandlerResult> {
  const db = getDb();
  // Remove dose logs for shared-entity medications, then the medications, then entities.
  await db.runAsync(
    `DELETE FROM dose_logs WHERE medication_id IN (
       SELECT m.id FROM medications m
       JOIN entities e ON m.entity_id = e.id
       WHERE e.shared_shift_id = ?
     )`,
    [msg.shiftId],
  );
  await db.runAsync(
    `DELETE FROM medications WHERE entity_id IN (
       SELECT id FROM entities WHERE shared_shift_id = ?
     )`,
    [msg.shiftId],
  );
  await db.runAsync(
    'DELETE FROM entities WHERE shared_shift_id = ?',
    [msg.shiftId],
  );
  await db.runAsync(
    "UPDATE caregiver_shifts SET status = 'completed' WHERE id = ?",
    [msg.shiftId],
  );
  return { ok: true, action: 'shift_completed' };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function handleMessage(msg: AnyMessage): Promise<HandlerResult> {
  try {
    switch (msg.type) {
      case 'SHIFT_INVITE':   return handleShiftInvite(msg);
      case 'SHIFT_ACCEPT':   return handleShiftAccept(msg);
      case 'SHIFT_DECLINE':  return handleShiftDecline(msg);
      case 'DOSE_UPDATE':    return handleDoseUpdate(msg);
      case 'REFILL_UPDATE':  return handleRefillUpdate(msg);
      case 'SHIFT_HANDBACK': return handleShiftHandback(msg);
      case 'SHIFT_COMPLETE': return handleShiftComplete(msg);
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Handler error' };
  }
}
