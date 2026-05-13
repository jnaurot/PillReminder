import * as Crypto from 'expo-crypto';
import { getDb } from './database';
import { getMedications } from './medications';
import { getSettings } from './settings';
import { getActiveShift } from './caregivers';
import { parseSchedule } from '../types';
import type { DoseLog, Medication, MedicationSchedule } from '../types';
export { todayStr } from '../utils/dateTime';

const uuidv4 = () => Crypto.randomUUID();

function now(): string {
  return new Date().toISOString();
}

function scheduledAt(dateStr: string, time: string): string {
  return `${dateStr}T${time}:00`;
}

// ─── Status ───────────────────────────────────────────────────────────────────

export type DoseStatus = 'locked' | 'upcoming' | 'due' | 'taken' | 'skipped' | 'missed';

export function getDoseStatus(
  scheduledAtStr: string | null,
  log: DoseLog | null,
  earlyWindowMin: number,
  missedWindowMin: number,
): DoseStatus {
  if (log) return log.skipped ? 'skipped' : 'taken';
  if (!scheduledAtStr) return 'upcoming'; // PRN available

  const scheduled = new Date(scheduledAtStr);
  const diffMin = (Date.now() - scheduled.getTime()) / 60000; // positive = past

  if (diffMin > missedWindowMin)  return 'missed';
  if (diffMin >= -earlyWindowMin) return 'due';     // within early window
  return 'locked';                                   // too far ahead
}

// ─── Scheduled dose ───────────────────────────────────────────────────────────

export interface ScheduledDose {
  key: string;
  medication: Medication;
  scheduledAt: string | null;
  timeLabel: string;
  log: DoseLog | null;
  status: DoseStatus;
  effectiveEarlyWindow: number;
  effectiveMissedWindow: number;
  effectiveMissedPolicy: 'none' | 'catch_up' | 'must_skip';
  prnLogs?: DoseLog[];
  // Caregiver shift context — populated when entity has shift_source = 'shared'
  shiftSource: string;
  sharedShiftId: string | null;
  entityPrimaryPhone: string | null;
}

// ─── Generate doses for an entity on a given date ─────────────────────────────

export async function getDosesForDate(
  entityId: string,
  dateStr: string
): Promise<ScheduledDose[]> {
  const [medications, settings] = await Promise.all([
    getMedications(entityId),
    getSettings(),
  ]);
  const db = getDb();

  const entityRow = await db.getFirstAsync<{
    shift_source: string;
    shared_shift_id: string | null;
    primary_phone: string | null;
  }>('SELECT shift_source, shared_shift_id, primary_phone FROM entities WHERE id = ?', [entityId]);
  const shiftSource = entityRow?.shift_source ?? 'local';
  const sharedShiftId = entityRow?.shared_shift_id ?? null;
  const entityPrimaryPhone = entityRow?.primary_phone ?? null;

  const logs = await db.getAllAsync<DoseLog>(
    `SELECT dl.* FROM dose_logs dl
     JOIN medications m ON dl.medication_id = m.id
     WHERE m.entity_id = ? AND dl.scheduled_at LIKE ?`,
    [entityId, `${dateStr}%`]
  );

  const logMap = new Map<string, DoseLog>();
  for (const log of logs) {
    logMap.set(`${log.medication_id}|${log.scheduled_at}`, log);
  }

  const prnLogs = await db.getAllAsync<DoseLog>(
    `SELECT dl.* FROM dose_logs dl
     JOIN medications m ON dl.medication_id = m.id
     WHERE m.entity_id = ? AND dl.taken_at LIKE ? AND dl.skipped = 0`,
    [entityId, `${dateStr}%`]
  );

  const date = new Date(`${dateStr}T00:00:00`);
  const dayOfWeek = date.getDay();
  const dayOfMonth = date.getDate();

  const doses: ScheduledDose[] = [];

  for (const med of medications) {
    // Don't show a medication on dates before it was entered.
    const ca = new Date(med.created_at);
    const createdDateStr = `${ca.getFullYear()}-${String(ca.getMonth() + 1).padStart(2, '0')}-${String(ca.getDate()).padStart(2, '0')}`;
    if (createdDateStr > dateStr) continue;

    const schedule: MedicationSchedule = parseSchedule(med.schedule);
    const earlyWindow  = med.early_window_minutes  ?? settings.early_window_minutes;
    const missedWindow = med.missed_window_minutes ?? settings.missed_window_minutes;
    const policy = (med.missed_policy ?? settings.global_missed_policy) as
      'none' | 'catch_up' | 'must_skip';

    function makeDose(sat: string | null, timeLabel: string): ScheduledDose {
      const log = sat ? (logMap.get(`${med.id}|${sat}`) ?? null) : null;
      return {
        key: `${med.id}|${sat ?? 'prn'}`,
        medication: med,
        scheduledAt: sat,
        timeLabel,
        log,
        status: getDoseStatus(sat, log, earlyWindow, missedWindow),
        effectiveEarlyWindow: earlyWindow,
        effectiveMissedWindow: missedWindow,
        effectiveMissedPolicy: policy,
        shiftSource,
        sharedShiftId,
        entityPrimaryPhone,
      };
    }

    switch (schedule.type) {
      case 'fixed_times':
        for (const time of schedule.times) {
          doses.push(makeDose(scheduledAt(dateStr, time), time));
        }
        break;

      case 'prn': {
        const todayPrnLogs = prnLogs.filter((l) => l.medication_id === med.id);
        const maxDoses = schedule.max_doses_per_day;
        const atMax = maxDoses !== null && todayPrnLogs.length >= maxDoses;
        doses.push({
          key: `${med.id}|prn`,
          medication: med,
          scheduledAt: null,
          timeLabel: atMax
            ? `As needed (${todayPrnLogs.length}/${maxDoses} today — limit reached)`
            : todayPrnLogs.length > 0
            ? `As needed (taken ${todayPrnLogs.length}× today)`
            : 'As needed',
          log: null,
          status: atMax ? 'taken' : 'upcoming',
          effectiveEarlyWindow: earlyWindow,
          effectiveMissedWindow: missedWindow,
          effectiveMissedPolicy: policy,
          prnLogs: todayPrnLogs.filter((l) => l.medication_id === med.id),
          shiftSource,
          sharedShiftId,
          entityPrimaryPhone,
        });
        break;
      }

      case 'weekly':
        if (!schedule.days.includes(dayOfWeek)) break;
        for (const time of schedule.times) {
          doses.push(makeDose(scheduledAt(dateStr, time), time));
        }
        break;

      case 'monthly':
        if (!schedule.days.includes(dayOfMonth)) break;
        for (const time of schedule.times) {
          doses.push(makeDose(scheduledAt(dateStr, time), time));
        }
        break;
    }
  }

  // Sort: locked/upcoming by time, due/missed first, settled last
  const statusOrder: Record<DoseStatus, number> = {
    missed: 0, due: 1, locked: 2, upcoming: 3, taken: 4, skipped: 5,
  };
  doses.sort((a, b) => {
    const so = statusOrder[a.status] - statusOrder[b.status];
    if (so !== 0) return so;
    return (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '');
  });

  return doses;
}

// ─── Find missed doses for a medication today ─────────────────────────────────

export async function getMissedDosesToday(
  medicationId: string,
  dateStr: string,
  earlyWindow: number,
  missedWindow: number,
): Promise<ScheduledDose[]> {
  const db = getDb();
  const med = await db.getFirstAsync<Medication>(
    `SELECT * FROM medications WHERE id = ?`, [medicationId]
  );
  if (!med) return [];

  const schedule = parseSchedule(med.schedule);
  const logs = await db.getAllAsync<DoseLog>(
    `SELECT * FROM dose_logs WHERE medication_id = ? AND scheduled_at LIKE ?`,
    [medicationId, `${dateStr}%`]
  );
  const logMap = new Map(logs.map((l) => [l.scheduled_at, l]));

  const missed: ScheduledDose[] = [];
  const times =
    schedule.type === 'fixed_times' ? schedule.times :
    schedule.type === 'weekly'      ? schedule.times :
    schedule.type === 'monthly'     ? schedule.times : [];

  for (const time of times) {
    const sat = `${dateStr}T${time}:00`;
    const log = logMap.get(sat) ?? null;
    const status = getDoseStatus(sat, log, earlyWindow, missedWindow);
    if (status === 'missed') {
      missed.push({
        key: `${med.id}|${sat}`,
        medication: med,
        scheduledAt: sat,
        timeLabel: time,
        log,
        status: 'missed',
        effectiveEarlyWindow: earlyWindow,
        effectiveMissedWindow: missedWindow,
        effectiveMissedPolicy: 'none',
        shiftSource: 'local',
        sharedShiftId: null,
        entityPrimaryPhone: null,
      });
    }
  }
  return missed;
}

// ─── Resolve who is logging (null = primary user) ────────────────────────────

async function resolveLoggerId(medicationId: string): Promise<string | null> {
  const shift = await getActiveShift();
  if (!shift) return null;
  const db = getDb();
  const med = await db.getFirstAsync<{ entity_id: string }>(
    'SELECT entity_id FROM medications WHERE id = ?', [medicationId]
  );
  if (!med) return null;
  const entityIds: string[] = JSON.parse(shift.entity_ids);
  if (entityIds[0] === '*' || entityIds.includes(med.entity_id)) {
    return shift.caregiver_id;
  }
  return null;
}

// ─── Log a dose taken (with optional catch-up) ────────────────────────────────

// Returns the appropriate taken_at for a scheduled slot.
// - Same-day: use the actual wall-clock time (when they pressed Take).
// - Past date: use the scheduled time (they took it then; we're just logging it now).
// created_at always stays as the wall-clock time so the audit trail is intact.
function takenAtFor(scheduledAtStr: string, recordedAt: string): string {
  const scheduledDate = scheduledAtStr.slice(0, 10);
  const todayDate = recordedAt.slice(0, 10);
  return scheduledDate < todayDate ? scheduledAtStr : recordedAt;
}

async function upsertLog(
  medicationId: string,
  scheduledAtStr: string,
  takenAt: string,
  recordedAt: string,
  skipped: 0 | 1,
  isCatchup: 0 | 1,
  note: string | null = null,
  caregiverId: string | null = null,
): Promise<DoseLog> {
  const db = getDb();
  const existing = await db.getFirstAsync<DoseLog>(
    `SELECT * FROM dose_logs WHERE medication_id = ? AND scheduled_at = ?`,
    [medicationId, scheduledAtStr]
  );
  if (existing) {
    await db.runAsync(
      `UPDATE dose_logs SET taken_at = ?, skipped = ?, is_catchup = ?, caregiver_id = ?, created_at = ? WHERE id = ?`,
      [skipped ? null : takenAt, skipped, isCatchup, caregiverId, recordedAt, existing.id]
    );
    return { ...existing, taken_at: skipped ? null : takenAt, skipped, is_catchup: isCatchup, caregiver_id: caregiverId };
  }
  const log: DoseLog = {
    id: uuidv4(),
    medication_id: medicationId,
    scheduled_at: scheduledAtStr,
    taken_at: skipped ? null : takenAt,
    skipped,
    is_catchup: isCatchup,
    notes: note,
    caregiver_id: caregiverId,
    created_at: recordedAt,
  };
  await db.runAsync(
    `INSERT INTO dose_logs (id, medication_id, scheduled_at, taken_at, skipped, is_catchup, notes, caregiver_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [log.id, log.medication_id, log.scheduled_at, log.taken_at, log.skipped, log.is_catchup, note, caregiverId, log.created_at]
  );
  return log;
}

export async function logDoseTaken(
  medicationId: string,
  scheduledAtStr: string | null,
  catchUpScheduledAt?: string,
  note?: string,
): Promise<void> {
  const recordedAt = now();
  const sat = scheduledAtStr ?? recordedAt;
  const caregiverId = await resolveLoggerId(medicationId);
  await upsertLog(medicationId, sat, takenAtFor(sat, recordedAt), recordedAt, 0, 0, note ?? null, caregiverId);
  if (catchUpScheduledAt) {
    await upsertLog(medicationId, catchUpScheduledAt, takenAtFor(catchUpScheduledAt, recordedAt), recordedAt, 0, 1, null, caregiverId);
  }
}

export async function logDoseSkipped(
  medicationId: string,
  scheduledAtStr: string,
): Promise<void> {
  const recordedAt = now();
  const caregiverId = await resolveLoggerId(medicationId);
  await upsertLog(medicationId, scheduledAtStr, scheduledAtStr, recordedAt, 1, 0, null, caregiverId);
}

// ─── All entities' doses for a date ──────────────────────────────────────────

export interface EntityDoses {
  entityId: string;
  entityName: string;
  doses: ScheduledDose[];
}

export async function getAllDosesForDate(dateStr: string): Promise<EntityDoses[]> {
  const db = getDb();
  const entities = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM entities WHERE deleted_at IS NULL ORDER BY name ASC`
  );
  const results = await Promise.all(
    entities.map(async (e) => ({
      entityId: e.id,
      entityName: e.name,
      doses: await getDosesForDate(e.id, dateStr),
    }))
  );
  return results.filter((r) => r.doses.length > 0);
}

// ─── Edit / delete a log entry ───────────────────────────────────────────────

export async function deleteLog(logId: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM dose_logs WHERE id = ?', [logId]);
}

export async function updateLogNote(logId: string, note: string | null): Promise<void> {
  const db = getDb();
  await db.runAsync('UPDATE dose_logs SET notes = ? WHERE id = ?', [note || null, logId]);
}

// ─── Query logs for compliance ─────────────────────────────────────────────────

export async function getLogsForMedication(
  medicationId: string,
  fromDate: string,
  toDate: string,
): Promise<DoseLog[]> {
  const db = getDb();
  return db.getAllAsync<DoseLog>(
    `SELECT * FROM dose_logs
     WHERE medication_id = ? AND scheduled_at >= ? AND scheduled_at <= ?
     ORDER BY scheduled_at ASC`,
    [medicationId, fromDate, toDate]
  );
}
