jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone' },
}));

jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/db/settings', () => ({ getSettings: jest.fn() }));
jest.mock('expo-notifications', () => ({
  __esModule: true,
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

import { getDb } from '../src/db/database';
import { getSettings } from '../src/db/settings';
import { rebuildNotificationPool } from '../src/notifications/scheduler';
import type { AppSettings } from '../src/db/settings';
import type { Medication } from '../src/types';

const notifications = jest.requireMock('expo-notifications') as {
  getAllScheduledNotificationsAsync: jest.Mock;
  cancelScheduledNotificationAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
};

function baseSettings(): AppSettings {
  return {
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
}

function makeMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    entity_id: 'entity-1',
    name: 'Aspirin',
    dosage: '10 mg',
    pills_per_dose: 1,
    schedule: JSON.stringify({ type: 'fixed_times', times: ['08:00'] }),
    food_requirement: null,
    interactions: '[]',
    missed_policy: null,
    early_window_minutes: null,
    missed_window_minutes: 60,
    color: '#4A90D9',
    notes: null,
    rxcui: null,
    drug_info: null,
    pill_appearance: null,
    created_at: '2026-06-01T12:00:00',
    updated_at: '2026-06-01T12:00:00',
    deleted_at: null,
    ...overrides,
  };
}

describe('notification scheduler regression coverage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 5, 13, 8, 15, 0, 0));
    jest.clearAllMocks();

    (getSettings as jest.Mock).mockResolvedValue(baseSettings());
    (getDb as jest.Mock).mockReturnValue({
      getAllAsync: jest.fn(async (sql: string) => {
        if (sql.includes('FROM medications')) {
          return [makeMedication()];
        }
        if (sql.includes('FROM dose_logs')) {
          return [];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    });

    notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    notifications.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
    notifications.scheduleNotificationAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a missed-dose alarm schedulable when the app opens after the dose time but before the missed window', async () => {
    await rebuildNotificationPool();

    const scheduledIdentifiers = notifications.scheduleNotificationAsync.mock.calls
      .map(([request]) => request.identifier);

    expect(scheduledIdentifiers).toContain('alarm-med-1-2026-06-13-0800');
    expect(scheduledIdentifiers).not.toContain('rem-med-1-2026-06-13-0800');

    const sameDayAlarmCall = notifications.scheduleNotificationAsync.mock.calls.find(
      ([request]) => request.identifier === 'alarm-med-1-2026-06-13-0800',
    );
    expect(sameDayAlarmCall?.[0]).toEqual(
      expect.objectContaining({
        trigger: expect.objectContaining({
          type: 'date',
          date: new Date(2026, 5, 13, 9, 0, 0, 0),
        }),
      }),
    );
  });

  it('rebuilds a still-valid missed-dose alarm instead of erasing it during a foreground refresh', async () => {
    notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'rem-med-1-2026-06-13-0800' },
      { identifier: 'alarm-med-1-2026-06-13-0800' },
    ]);

    await rebuildNotificationPool();

    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-med-1-2026-06-13-0800');
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('alarm-med-1-2026-06-13-0800');

    const scheduledIdentifiers = notifications.scheduleNotificationAsync.mock.calls
      .map(([request]) => request.identifier);
    expect(scheduledIdentifiers).toContain('alarm-med-1-2026-06-13-0800');
    expect(scheduledIdentifiers).not.toContain('rem-med-1-2026-06-13-0800');
  });
});
