import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getDb } from '../db/database';
import { getSettings } from '../db/settings';
import { parseSchedule } from '../types';
import type { Medication } from '../types';
import { dateToStr } from '../utils/dateTime';
import { scheduleAlarmNative, cancelAlarmNative, dismissActiveAlarmNative } from '../native/alarmScheduler';

const isExpoGo = Constants.executionEnvironment === 'storeClient';

type N = typeof import('expo-notifications');
let _n: N | null = null;
async function getN(): Promise<N | null> {
  if (isExpoGo) return null;
  if (!_n) _n = await import('expo-notifications');
  return _n;
}

// ─── Notification ID scheme ───────────────────────────────────────────────────
//   rem-{medId}-{slot}            → repeating reminder
//   miss-{medId}-{dateStr}-{HHmm} → one-time missed alert
//   alarm-{medId}-{dateStr}-{HHmm}→ one-time high-priority alarm
//   refill-{medId}                → one-time refill reminder

function remId(medId: string, slot: string)                        { return `rem-${medId}-${slot}`; }
function missId(medId: string, dateStr: string, timeHHmm: string)  { return `miss-${medId}-${dateStr}-${timeHHmm.replace(':', '')}`; }
function alarmId(medId: string, dateStr: string, timeHHmm: string) { return `alarm-${medId}-${dateStr}-${timeHHmm.replace(':', '')}`; }
function refillId(medId: string)                                    { return `refill-${medId}`; }

function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':').map(Number);
  return { hour: h, minute: m };
}

// ─── Cancel all notifications for a medication ────────────────────────────────

export async function cancelForMedication(medId: string): Promise<void> {
  const N = await getN();
  if (!N) return;
  try {
    const scheduled = await N.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) =>
          n.identifier.startsWith(`rem-${medId}-`) ||
          n.identifier.startsWith(`miss-${medId}-`) ||
          n.identifier.startsWith(`alarm-${medId}-`) ||
          n.identifier === refillId(medId)
        )
        .map((n) => N.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch {}
  if (Platform.OS === 'android') {
    try {
      const db = getDb();
      const rows = await db.getAllAsync<{ alarm_id: string }>(
        'SELECT alarm_id FROM native_alarms WHERE med_id = ?', [medId]
      );
      for (const row of rows) cancelAlarmNative(row.alarm_id);
      await db.runAsync('DELETE FROM native_alarms WHERE med_id = ?', [medId]);
    } catch {}
  }
}

// ─── Cancel the missed alert for a specific scheduled dose ────────────────────

export async function cancelMissedAlert(medId: string, scheduledAtStr: string): Promise<void> {
  const N = await getN();
  if (!N) return;
  try {
    const [dateStr, timePart] = scheduledAtStr.split('T');
    const timeHHmm = timePart?.slice(0, 5) ?? '';
    const id = missId(medId, dateStr, timeHHmm);
    await N.cancelScheduledNotificationAsync(id);
    await N.dismissNotificationAsync(id).catch(() => {});
  } catch {}
}

// ─── Cancel the native alarm for a specific scheduled dose ────────────────────

export async function cancelAlarmAlert(medId: string, scheduledAtStr: string): Promise<void> {
  try {
    const [dateStr, timePart] = scheduledAtStr.split('T');
    const timeHHmm = timePart?.slice(0, 5) ?? '';
    const id = alarmId(medId, dateStr, timeHHmm);
    cancelAlarmNative(id);
    dismissActiveAlarmNative();
    if (Platform.OS === 'android') {
      try {
        const db = getDb();
        await db.runAsync('DELETE FROM native_alarms WHERE alarm_id = ?', [id]);
      } catch {}
    }
  } catch {}
}

// ─── Refill reminder ──────────────────────────────────────────────────────────

export async function cancelRefillAlert(medId: string): Promise<void> {
  const N = await getN();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(refillId(medId));
  } catch {}
}

export async function scheduleRefillAlert(
  medId: string,
  medName: string,
  refillDate: string,
  daysSupply: number,
  alertDays: number,
): Promise<void> {
  const N = await getN();
  if (!N) return;
  await cancelRefillAlert(medId);

  // Fire at 9am on the day when (daysSupply - alertDays) days have elapsed since refill.
  const fireDate = new Date(`${refillDate}T09:00:00`);
  fireDate.setDate(fireDate.getDate() + daysSupply - alertDays);
  if (fireDate <= new Date()) return;

  try {
    await N.scheduleNotificationAsync({
      identifier: refillId(medId),
      content: {
        title: `Refill needed: ${medName}`,
        body: `About ${alertDays} day${alertDays !== 1 ? 's' : ''} of supply remaining.`,
        sound: true,
        data: { medId, type: 'refill' },
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DATE,
        date: fireDate,
      },
    });
  } catch {}
}

// ─── Schedule one missed-alert for a specific date + time ────────────────────

async function scheduleMissedAlertForDate(
  N: N,
  med: Medication,
  date: Date,
  time: string,
  missedWindowMin: number,
): Promise<void> {
  const { hour, minute } = parseTime(time);
  const scheduledMs = new Date(
    date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0
  ).getTime();
  const missedTime = new Date(scheduledMs + missedWindowMin * 60000);
  if (missedTime <= new Date()) return;

  const dateStr = dateToStr(date);
  await N.scheduleNotificationAsync({
    identifier: missId(med.id, dateStr, time),
    content: {
      title: `Missed: ${med.name}`,
      body: `${time} dose not logged — take or skip it now.`,
      sound: true,
      data: { medId: med.id, scheduledAt: `${dateStr}T${time}:00` },
    },
    trigger: {
      type: N.SchedulableTriggerInputTypes.DATE,
      date: missedTime,
    },
  });
}

// ─── Schedule one alarm for a specific date + time ───────────────────────────

async function scheduleAlarmForDate(
  N: N,
  med: Medication,
  date: Date,
  time: string,
  delayMin: number,
  alarmType: string,
): Promise<void> {
  const { hour, minute } = parseTime(time);
  const scheduledMs = new Date(
    date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0
  ).getTime();
  const alarmTime = new Date(scheduledMs + delayMin * 60000);
  if (alarmTime <= new Date()) return;

  const dateStr = dateToStr(date);
  const id = alarmId(med.id, dateStr, time);
  const title = `Missed dose: ${med.name}`;
  const body = `${time} dose has not been logged. Tap to open PillReminder.`;
  const types = alarmType.split(',').map((s) => s.trim());
  const hasSound = types.includes('sound');
  const hasVibration = types.includes('vibration');
  const channelId = hasSound && hasVibration ? 'dose-alarm-v3'
    : hasSound ? 'dose-alarm-sound-v3'
    : 'dose-alarm-vibrate-v3';

  if (Platform.OS === 'android') {
    scheduleAlarmNative(id, title, body, alarmTime.getTime(), channelId);
    try {
      await getDb().runAsync(
        'INSERT OR REPLACE INTO native_alarms (alarm_id, med_id) VALUES (?, ?)',
        [id, med.id],
      );
    } catch {}
  } else {
    await N.scheduleNotificationAsync({
      identifier: id,
      content: {
        title,
        body,
        priority: 'max',
        sticky: true,
        channelId,
        data: { medId: med.id, scheduledAt: `${dateStr}T${time}:00`, type: 'alarm' },
      } as any,
      trigger: {
        type: N.SchedulableTriggerInputTypes.DATE,
        date: alarmTime,
      },
    });
  }
}

// ─── Schedule fixed-times (daily repeating) ───────────────────────────────────

async function scheduleFixedTimes(
  N: N, med: Medication, times: string[], missedWindowMin: number,
  alarm?: { delayMin: number; type: string },
): Promise<void> {
  const now = new Date();
  for (const time of times) {
    const { hour, minute } = parseTime(time);
    await N.scheduleNotificationAsync({
      identifier: remId(med.id, time.replace(':', '')),
      content: {
        title: `Time for ${med.name}`,
        body: `${med.dosage} · ${med.pills_per_dose} per dose`,
        sound: true,
        data: { medId: med.id },
      },
      trigger: { type: N.SchedulableTriggerInputTypes.DAILY, hour, minute },
    });
    for (let i = 0; i <= 1; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      await scheduleMissedAlertForDate(N, med, d, time, missedWindowMin);
      if (alarm) await scheduleAlarmForDate(N, med, d, time, alarm.delayMin, alarm.type);
    }
  }
}

// ─── Schedule weekly ──────────────────────────────────────────────────────────

async function scheduleWeekly(
  N: N, med: Medication, days: number[], times: string[], missedWindowMin: number,
  alarm?: { delayMin: number; type: string },
): Promise<void> {
  const now = new Date();
  for (const jsWeekday of days) {
    for (const time of times) {
      const { hour, minute } = parseTime(time);
      await N.scheduleNotificationAsync({
        identifier: remId(med.id, `${jsWeekday}-${time.replace(':', '')}`),
        content: {
          title: `Time for ${med.name}`,
          body: `${med.dosage} · ${med.pills_per_dose} per dose`,
          sound: true,
          data: { medId: med.id },
        },
        trigger: {
          type: N.SchedulableTriggerInputTypes.WEEKLY,
          weekday: jsWeekday + 1,
          hour,
          minute,
        },
      });
      for (let i = 0; i < 28; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        if (d.getDay() === jsWeekday) {
          await scheduleMissedAlertForDate(N, med, d, time, missedWindowMin);
          if (alarm) await scheduleAlarmForDate(N, med, d, time, alarm.delayMin, alarm.type);
        }
      }
    }
  }
}

// ─── Schedule monthly (one-time per occurrence) ───────────────────────────────

function getNextMonthlyDates(dayOfMonth: number, count: number): Date[] {
  const results: Date[] = [];
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  while (results.length < count) {
    const maxDay = new Date(year, month + 1, 0).getDate();
    const candidate = new Date(year, month, Math.min(dayOfMonth, maxDay));
    if (candidate >= now) results.push(candidate);
    if (++month > 11) { month = 0; year++; }
  }
  return results;
}

async function scheduleMonthly(
  N: N, med: Medication, days: number[], times: string[], missedWindowMin: number,
  alarm?: { delayMin: number; type: string },
): Promise<void> {
  for (const dayOfMonth of days) {
    for (const time of times) {
      const { hour, minute } = parseTime(time);
      for (const date of getNextMonthlyDates(dayOfMonth, 3)) {
        const dateStr = dateToStr(date);
        const fireTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0);
        if (fireTime > new Date()) {
          await N.scheduleNotificationAsync({
            identifier: remId(med.id, `${dateStr}-${time.replace(':', '')}`),
            content: {
              title: `Time for ${med.name}`,
              body: `${med.dosage} · ${med.pills_per_dose} per dose`,
              sound: true,
              data: { medId: med.id },
            },
            trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: fireTime },
          });
        }
        await scheduleMissedAlertForDate(N, med, date, time, missedWindowMin);
        if (alarm) await scheduleAlarmForDate(N, med, date, time, alarm.delayMin, alarm.type);
      }
    }
  }
}

// ─── Main: schedule all notifications for one medication ─────────────────────

export async function scheduleForMedication(
  med: Medication,
  missedWindowMin: number,
  alarm?: { delayMin: number; type: string },
): Promise<void> {
  const N = await getN();
  if (!N) return;
  await cancelForMedication(med.id);
  const schedule = parseSchedule(med.schedule);
  try {
    switch (schedule.type) {
      case 'fixed_times': await scheduleFixedTimes(N, med, schedule.times, missedWindowMin, alarm); break;
      case 'weekly':      await scheduleWeekly(N, med, schedule.days, schedule.times, missedWindowMin, alarm); break;
      case 'monthly':     await scheduleMonthly(N, med, schedule.days, schedule.times, missedWindowMin, alarm); break;
      case 'prn':         break;
    }
  } catch {}
}

// ─── Update app icon badge ────────────────────────────────────────────────────
// Pass the count of actionable (due + missed) doses computed by the caller,
// since computing status accurately requires schedule introspection.

export async function setBadge(count: number): Promise<void> {
  const N = await getN();
  if (!N) return;
  try { await N.setBadgeCountAsync(count); } catch {}
}

// ─── Rebuild all notifications from DB ───────────────────────────────────────

export async function rescheduleAll(): Promise<void> {
  const N = await getN();
  if (!N) return;
  try {
    await N.cancelAllScheduledNotificationsAsync();
    if (Platform.OS === 'android') {
      try {
        const db = getDb();
        const rows = await db.getAllAsync<{ alarm_id: string }>('SELECT alarm_id FROM native_alarms');
        for (const row of rows) cancelAlarmNative(row.alarm_id);
        await db.runAsync('DELETE FROM native_alarms');
      } catch {}
    }
    const db = getDb();
    const meds = await db.getAllAsync<Medication>(`SELECT * FROM medications WHERE deleted_at IS NULL`);
    const settings = await getSettings();
    const alarm = settings.alarm_enabled
      ? { delayMin: settings.alarm_delay_minutes, type: settings.alarm_type }
      : undefined;
    for (const med of meds) {
      await scheduleForMedication(med, med.missed_window_minutes ?? settings.missed_window_minutes, alarm);
      // Restore refill alert if this medication has a recent prescription with days_supply
      const rx = await db.getFirstAsync<{ refill_date: string; days_supply: number | null }>(
        `SELECT refill_date, days_supply FROM prescriptions
         WHERE medication_id = ? ORDER BY refill_date DESC LIMIT 1`,
        [med.id]
      );
      if (rx?.days_supply) {
        await scheduleRefillAlert(med.id, med.name, rx.refill_date, rx.days_supply, settings.refill_alert_days);
      }
    }
  } catch {}
}
