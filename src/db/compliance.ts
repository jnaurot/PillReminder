import { getDb } from './database';
import { getMedications } from './medications';
import { parseSchedule } from '../types';
import type { Medication, DoseLog } from '../types';

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function getScheduledTimesForDate(med: Medication, date: Date): string[] {
  const schedule = parseSchedule(med.schedule);
  switch (schedule.type) {
    case 'fixed_times':
      return schedule.times;
    case 'weekly':
      return schedule.days.includes(date.getDay()) ? schedule.times : [];
    case 'monthly':
      return schedule.days.includes(date.getDate()) ? schedule.times : [];
    case 'prn':
      return [];
  }
}

export interface DayRecord {
  date: string;
  scheduled: number;
  taken: number;
  skipped: number;
  missed: number;
}

export interface MedicationCompliance {
  medication: Medication;
  days: DayRecord[];         // 90 days, oldest first
  adherence7: number | null;  // % taken of all scheduled, last 7 days
  adherence30: number | null;
  adherence90: number | null;
  avgOffsetMinutes: number | null; // negative = early, positive = late
  streak: number;             // consecutive days all scheduled doses taken
}

export async function getMedicationCompliance(
  med: Medication,
): Promise<MedicationCompliance> {
  const db = getDb();
  const DAYS_BACK = 90;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromDate = addDays(today, -DAYS_BACK);

  const logs = await db.getAllAsync<DoseLog>(
    `SELECT * FROM dose_logs
     WHERE medication_id = ? AND scheduled_at >= ? AND scheduled_at <= ?`,
    [med.id, `${toDateStr(fromDate)}T00:00:00`, `${toDateStr(today)}T23:59:59`]
  );

  const logMap = new Map<string, DoseLog>();
  for (const log of logs) {
    logMap.set(log.scheduled_at, log);
  }

  const now = new Date();
  const days: DayRecord[] = [];

  for (let i = DAYS_BACK; i >= 0; i--) {
    const d = addDays(today, -i);
    const ds = toDateStr(d);
    const times = getScheduledTimesForDate(med, d);

    let taken = 0, skipped = 0, missed = 0;
    for (const time of times) {
      const sat = `${ds}T${time}:00`;
      const log = logMap.get(sat);
      if (log) {
        if (log.skipped) skipped++;
        else taken++;
      } else if (new Date(`${ds}T${time}:00`) < now) {
        missed++;
      }
    }

    days.push({ date: ds, scheduled: times.length, taken, skipped, missed });
  }

  function adherenceFor(numDays: number): number | null {
    const slice = days.slice(Math.max(0, days.length - numDays));
    const total = slice.reduce((s, d) => s + d.taken + d.skipped + d.missed, 0);
    if (total === 0) return null;
    return Math.round((slice.reduce((s, d) => s + d.taken, 0) / total) * 100);
  }

  // Timing offset from non-catchup taken doses
  const offsets: number[] = [];
  for (const log of logs) {
    if (!log.skipped && log.taken_at && !log.is_catchup) {
      offsets.push(
        (new Date(log.taken_at).getTime() - new Date(log.scheduled_at).getTime()) / 60000
      );
    }
  }
  const avgOffsetMinutes =
    offsets.length > 0
      ? Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length)
      : null;

  // Streak: consecutive days (backward from today) where all scheduled doses were taken
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.scheduled === 0) continue;
    if (d.taken === d.scheduled) streak++;
    else break;
  }

  return {
    medication: med,
    days,
    adherence7: adherenceFor(7),
    adherence30: adherenceFor(30),
    adherence90: adherenceFor(90),
    avgOffsetMinutes,
    streak,
  };
}

export async function getEntityCompliance(
  entityId: string,
): Promise<MedicationCompliance[]> {
  const meds = await getMedications(entityId);
  const scheduled = meds.filter((m) => parseSchedule(m.schedule).type !== 'prn');
  return Promise.all(scheduled.map(getMedicationCompliance));
}
