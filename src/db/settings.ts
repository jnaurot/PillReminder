import { getDb } from './database';

export interface AppSettings {
  early_window_minutes: number;
  missed_window_minutes: number;
  global_missed_policy: 'none' | 'catch_up' | 'must_skip';
  refill_alert_days: number;
  primary_phone: string;
  alarm_enabled: boolean;
  alarm_delay_minutes: number;
  alarm_type: string; // comma-separated: 'sound', 'vibration'
  inactivity_timeout_minutes: number; // 0 = Never
  flag_secure: boolean;
}

const DEFAULTS: AppSettings = {
  early_window_minutes: 30,
  missed_window_minutes: 60,
  global_missed_policy: 'none',
  refill_alert_days: 7,
  primary_phone: '',
  alarm_enabled: false,
  alarm_delay_minutes: 30,
  alarm_type: 'sound,vibration',
  inactivity_timeout_minutes: 0,
  flag_secure: false,
};

export async function getSettings(): Promise<AppSettings> {
  const db = getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM settings`
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    early_window_minutes: map.early_window_minutes
      ? parseInt(map.early_window_minutes, 10)
      : DEFAULTS.early_window_minutes,
    missed_window_minutes: map.missed_window_minutes
      ? parseInt(map.missed_window_minutes, 10)
      : DEFAULTS.missed_window_minutes,
    global_missed_policy: (map.global_missed_policy as AppSettings['global_missed_policy'])
      ?? DEFAULTS.global_missed_policy,
    refill_alert_days: map.refill_alert_days
      ? parseInt(map.refill_alert_days, 10)
      : DEFAULTS.refill_alert_days,
    primary_phone: map.primary_phone ?? DEFAULTS.primary_phone,
    alarm_enabled: map.alarm_enabled === 'true',
    alarm_delay_minutes: map.alarm_delay_minutes
      ? parseInt(map.alarm_delay_minutes, 10)
      : DEFAULTS.alarm_delay_minutes,
    alarm_type: map.alarm_type ?? DEFAULTS.alarm_type,
    inactivity_timeout_minutes: map.inactivity_timeout_minutes
      ? parseInt(map.inactivity_timeout_minutes, 10)
      : DEFAULTS.inactivity_timeout_minutes,
    flag_secure: map.flag_secure === 'true',
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
