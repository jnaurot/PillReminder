import { getDb } from './database';

export interface AppSettings {
  early_window_minutes: number;
  missed_window_minutes: number;
  global_missed_policy: 'none' | 'catch_up' | 'must_skip';
  refill_alert_days: number;
  primary_phone: string;
  alarm_type: 'sound,vibration' | 'sound' | 'vibration' | 'none';
  inactivity_timeout_minutes: number; // 0 = Never
  flag_secure: boolean;
  primary_name: string;
}

const DEFAULTS: AppSettings = {
  early_window_minutes: 30,
  missed_window_minutes: 60,
  global_missed_policy: 'none',
  refill_alert_days: 7,
  primary_phone: '',
  alarm_type: 'sound,vibration',
  inactivity_timeout_minutes: 0,
  flag_secure: false,
  primary_name: 'Primary Caregiver',
};

function parseIntSetting(value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getSettings(): Promise<AppSettings> {
  const db = getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM settings`
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    early_window_minutes: parseIntSetting(
      map.early_window_minutes,
      DEFAULTS.early_window_minutes,
    ),
    missed_window_minutes: parseIntSetting(
      map.missed_window_minutes,
      DEFAULTS.missed_window_minutes,
    ),
    global_missed_policy: (map.global_missed_policy as AppSettings['global_missed_policy'])
      ?? DEFAULTS.global_missed_policy,
    refill_alert_days: parseIntSetting(
      map.refill_alert_days,
      DEFAULTS.refill_alert_days,
    ),
    primary_phone: map.primary_phone ?? DEFAULTS.primary_phone,
    alarm_type: (map.alarm_type as AppSettings['alarm_type']) ?? DEFAULTS.alarm_type,
    inactivity_timeout_minutes: parseIntSetting(
      map.inactivity_timeout_minutes,
      DEFAULTS.inactivity_timeout_minutes,
    ),
    flag_secure: map.flag_secure === 'true',
    primary_name: map.primary_name ?? DEFAULTS.primary_name,
  };
}

export async function setSetting(key: keyof AppSettings, value: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}
