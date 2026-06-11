import Constants from 'expo-constants';
import { getDb } from '../db/database';
import { getRefillStatus } from '../db/prescriptions';
import { getSettings } from '../db/settings';
import { parseSchedule } from '../types';
import type { Medication } from '../types';
import { dateToStr } from '../utils/dateTime';

const isExpoGo = Constants.executionEnvironment === 'storeClient';
export const POOL_BUDGET = 63;
const UPCOMING_WINDOW_DAYS = 35;

type N = typeof import('expo-notifications');
let _n: N | null = null;

async function getN(): Promise<N | null> {
  if (isExpoGo) return null;
  if (!_n) _n = await import('expo-notifications');
  return _n;
}

export interface DoseSlot {
  medId: string;
  medName: string;
  dosage: string;
  pillsPerDose: number;
  scheduledAt: Date;
  missedWindowMin: number;
  color: string;
}

function remId(medId: string, dateStr: string, timeHHmm: string) {
  return `rem-${medId}-${dateStr}-${timeHHmm.replace(':', '')}`;
}

function alarmId(medId: string, dateStr: string, timeHHmm: string) {
  return `alarm-${medId}-${dateStr}-${timeHHmm.replace(':', '')}`;
}

function refillId(medId: string) {
  return `refill-${medId}`;
}

function focusToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function routeForDoseFocus(medId: string, scheduledAt: string | null): string {
  const params = new URLSearchParams({ medId, focusToken: focusToken() });
  if (scheduledAt) params.set('scheduledAt', scheduledAt);
  return `/today?${params.toString()}`;
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function alarmChannelForType(alarmType: string): string {
  switch (alarmType) {
    case 'sound':
      return 'dose-alarm-sound-v3';
    case 'vibration':
      return 'dose-alarm-vibrate-v3';
    case 'none':
      return 'dose-alarm-silent-v3';
    case 'sound,vibration':
    default:
      return 'dose-alarm-v3';
  }
}

function slotIsoString(slot: DoseSlot): string {
  return `${dateToStr(slot.scheduledAt)}T${String(slot.scheduledAt.getHours()).padStart(2, '0')}:${String(slot.scheduledAt.getMinutes()).padStart(2, '0')}:00`;
}

function buildReminderId(medId: string, scheduledAtStr: string): string {
  const [dateStr, timePart] = scheduledAtStr.split('T');
  const timeHHmm = timePart?.slice(0, 5) ?? '';
  return remId(medId, dateStr, timeHHmm);
}

function buildAlarmId(medId: string, scheduledAtStr: string): string {
  const [dateStr, timePart] = scheduledAtStr.split('T');
  const timeHHmm = timePart?.slice(0, 5) ?? '';
  return alarmId(medId, dateStr, timeHHmm);
}

export async function routeForDoseNotification(
  _identifier: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  const medId = typeof data?.medId === 'string' ? data.medId : null;
  if (!medId) return null;
  const scheduledAt = typeof data?.scheduledAt === 'string' ? data.scheduledAt : null;
  return routeForDoseFocus(medId, scheduledAt);
}

export async function cancelForMedication(medId: string): Promise<void> {
  const N = await getN();
  if (!N) return;
  try {
    const scheduled = await N.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) =>
          n.identifier.startsWith(`rem-${medId}-`) ||
          n.identifier.startsWith(`alarm-${medId}-`) ||
          n.identifier === refillId(medId),
        )
        .map((n) => N.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch {}
}

export async function cancelDoseNotifications(medId: string, scheduledAtStr: string): Promise<void> {
  const N = await getN();
  if (!N) return;
  const reminderId = buildReminderId(medId, scheduledAtStr);
  const alarmNotificationId = buildAlarmId(medId, scheduledAtStr);
  try {
    await Promise.all([
      N.cancelScheduledNotificationAsync(reminderId).catch(() => {}),
      N.cancelScheduledNotificationAsync(alarmNotificationId).catch(() => {}),
      N.dismissNotificationAsync(reminderId).catch(() => {}),
      N.dismissNotificationAsync(alarmNotificationId).catch(() => {}),
    ]);
  } catch {}
}

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
  unitsRemaining: number,
  dailyUnitsTaken: number,
  unit: string,
  alertDays: number,
): Promise<void> {
  const N = await getN();
  if (!N) return;
  await cancelRefillAlert(medId);

  if (!(dailyUnitsTaken > 0)) return;

  const thresholdUnits = dailyUnitsTaken * alertDays;
  let fireDate = new Date();
  if (unitsRemaining > thresholdUnits) {
    const daysUntilThreshold = (unitsRemaining - thresholdUnits) / dailyUnitsTaken;
    const msUntilThreshold = daysUntilThreshold * 86400000;
    fireDate = new Date(Date.now() + msUntilThreshold);
    fireDate.setHours(9, 0, 0, 0);
  } else {
    fireDate = new Date(Date.now() + 60_000);
  }

  try {
    await N.scheduleNotificationAsync({
      identifier: refillId(medId),
      content: {
        title: `Refill needed: ${medName}`,
        body: `Estimated supply is at or near ${Math.ceil(thresholdUnits)} ${unit}.`,
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

function pushSlotIfUpcoming(
  slots: DoseSlot[],
  med: Medication,
  candidate: Date,
  from: Date,
  end: Date,
  missedWindowMin: number,
): void {
  if (candidate < from || candidate > end) return;
  slots.push({
    medId: med.id,
    medName: med.name,
    dosage: med.dosage,
    pillsPerDose: med.pills_per_dose,
    scheduledAt: candidate,
    missedWindowMin,
    color: med.color,
  });
}

function expandMedicationSlots(
  med: Medication,
  from: Date,
  end: Date,
  missedWindowMin: number,
): DoseSlot[] {
  const schedule = parseSchedule(med.schedule);
  if (schedule.type === 'prn') return [];

  const slots: DoseSlot[] = [];
  const createdAt = new Date(med.created_at);
  const firstDay = startOfDay(from);
  const totalDays = Math.ceil((end.getTime() - firstDay.getTime()) / 86400000);

  for (let offset = 0; offset <= totalDays; offset++) {
    const day = addDays(firstDay, offset);
    if (day < startOfDay(createdAt)) continue;

    if (schedule.type === 'weekly' && !schedule.days.includes(day.getDay())) continue;
    if (schedule.type === 'monthly' && !schedule.days.includes(day.getDate())) continue;

    const times = schedule.type === 'fixed_times'
      ? schedule.times
      : schedule.type === 'weekly'
        ? schedule.times
        : schedule.times;

    for (const time of times) {
      const { hour, minute } = parseTime(time);
      const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
      pushSlotIfUpcoming(slots, med, candidate, from, end, missedWindowMin);
    }
  }

  return slots;
}

export async function getUpcomingDoseSlots(from: Date, maxSlots: number): Promise<DoseSlot[]> {
  const db = getDb();
  const [meds, settings] = await Promise.all([
    db.getAllAsync<Medication>('SELECT * FROM medications WHERE deleted_at IS NULL'),
    getSettings(),
  ]);

  const end = addDays(from, UPCOMING_WINDOW_DAYS);
  const logs = await db.getAllAsync<{
    medication_id: string;
    scheduled_at: string;
    skipped: number;
    taken_at: string | null;
  }>(
    `SELECT medication_id, scheduled_at, skipped, taken_at
     FROM dose_logs
     WHERE scheduled_at >= ? AND scheduled_at <= ?`,
    [slotIsoString({
      medId: '',
      medName: '',
      dosage: '',
      pillsPerDose: 0,
      scheduledAt: from,
      missedWindowMin: 0,
      color: '',
    }), `${dateToStr(end)}T23:59:59`],
  );

  const completed = new Set(
    logs
      .filter((log) => log.skipped === 1 || log.taken_at !== null)
      .map((log) => `${log.medication_id}|${log.scheduled_at}`),
  );

  const allSlots = meds.flatMap((med) =>
    expandMedicationSlots(
      med,
      from,
      end,
      med.missed_window_minutes ?? settings.missed_window_minutes,
    ),
  );

  return allSlots
    .filter((slot) => !completed.has(`${slot.medId}|${slotIsoString(slot)}`))
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .slice(0, maxSlots);
}

export async function rebuildNotificationPool(): Promise<void> {
  const N = await getN();
  if (!N) return;

  try {
    const [scheduled, settings, slots] = await Promise.all([
      N.getAllScheduledNotificationsAsync(),
      getSettings(),
      getUpcomingDoseSlots(new Date(), Math.floor(POOL_BUDGET / 2)),
    ]);

    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith('rem-') || n.identifier.startsWith('alarm-'))
        .map((n) => N.cancelScheduledNotificationAsync(n.identifier)),
    );

    const alarmChannelId = alarmChannelForType(settings.alarm_type);

    for (const slot of slots) {
      const scheduledAtStr = slotIsoString(slot);
      const dateStr = dateToStr(slot.scheduledAt);
      const timeHHmm = scheduledAtStr.slice(11, 16);
      const reminderIdentifier = remId(slot.medId, dateStr, timeHHmm);
      const alarmIdentifier = alarmId(slot.medId, dateStr, timeHHmm);
      const alarmAt = new Date(slot.scheduledAt.getTime() + slot.missedWindowMin * 60000);

      await N.scheduleNotificationAsync({
        identifier: reminderIdentifier,
        content: {
          title: `Time to take ${slot.medName}`,
          body: `${slot.dosage} · ${slot.pillsPerDose} per dose`,
          sound: true,
          channelId: 'dose-reminders',
          data: { medId: slot.medId, scheduledAt: scheduledAtStr, type: 'reminder' },
        } as any,
        trigger: {
          type: N.SchedulableTriggerInputTypes.DATE,
          date: slot.scheduledAt,
        },
      });

      await N.scheduleNotificationAsync({
        identifier: alarmIdentifier,
        content: {
          title: `Missed dose: ${slot.medName}`,
          body: `${timeHHmm} dose has not been logged. Tap to open PillReminder.`,
          priority: 'max',
          sticky: true,
          channelId: alarmChannelId,
          data: { medId: slot.medId, scheduledAt: scheduledAtStr, type: 'alarm' },
        } as any,
        trigger: {
          type: N.SchedulableTriggerInputTypes.DATE,
          date: alarmAt,
        },
      });
    }
  } catch {}
}

export async function scheduleForMedication(
  _med: Medication,
  _missedWindowMin: number,
  _alarm?: { delayMin: number; type: string },
): Promise<void> {
  await rebuildNotificationPool();
}

export async function setBadge(count: number): Promise<void> {
  const N = await getN();
  if (!N) return;
  try {
    await N.setBadgeCountAsync(count);
  } catch {}
}

export async function rescheduleAll(): Promise<void> {
  const N = await getN();
  if (!N) return;

  try {
    await rebuildNotificationPool();
    const db = getDb();
    const meds = await db.getAllAsync<Medication>('SELECT * FROM medications WHERE deleted_at IS NULL');
    const settings = await getSettings();
    for (const med of meds) {
      const status = await getRefillStatus(med.id, settings.refill_alert_days);
      if (status?.dailyUnitsTaken && status.unitsRemaining !== null) {
        await scheduleRefillAlert(
          med.id,
          med.name,
          status.unitsRemaining,
          status.dailyUnitsTaken,
          status.prescription.unit,
          settings.refill_alert_days,
        );
      }
    }
  } catch {}
}
