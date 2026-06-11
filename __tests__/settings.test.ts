jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));

import { getDb } from '../src/db/database';
import { getSettings, setSetting } from '../src/db/settings';

const getDbMock = getDb as jest.MockedFunction<typeof getDb>;

describe('getSettings', () => {
  it('ignores legacy alarm rows and still returns current settings', async () => {
    getDbMock.mockReturnValue({
      getAllAsync: jest.fn().mockResolvedValue([
        { key: 'missed_window_minutes', value: '75' },
        { key: 'alarm_enabled', value: 'true' },
        { key: 'alarm_delay_minutes', value: '30' },
        { key: 'alarm_type', value: 'vibration' },
        { key: 'primary_name', value: 'Alex' },
      ]),
    } as any);

    await expect(getSettings()).resolves.toEqual(
      expect.objectContaining({
        missed_window_minutes: 75,
        alarm_type: 'vibration',
        primary_name: 'Alex',
      }),
    );
  });

  it('round-trips all supported alarm_type values', async () => {
    const values = ['sound,vibration', 'sound', 'vibration', 'none'] as const;

    for (const value of values) {
      getDbMock.mockReturnValue({
        getAllAsync: jest.fn().mockResolvedValue([{ key: 'alarm_type', value }]),
      } as any);

      await expect(getSettings()).resolves.toEqual(
        expect.objectContaining({ alarm_type: value }),
      );
    }
  });

  it('falls back to defaults when numeric settings are malformed', async () => {
    getDbMock.mockReturnValue({
      getAllAsync: jest.fn().mockResolvedValue([
        { key: 'early_window_minutes', value: 'abc' },
        { key: 'missed_window_minutes', value: 'NaN' },
        { key: 'refill_alert_days', value: '' },
        { key: 'inactivity_timeout_minutes', value: 'oops' },
      ]),
    } as any);

    await expect(getSettings()).resolves.toEqual(
      expect.objectContaining({
        early_window_minutes: 30,
        missed_window_minutes: 60,
        refill_alert_days: 7,
        inactivity_timeout_minutes: 0,
      }),
    );
  });

  it('upserts individual settings values', async () => {
    const runAsync = jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    getDbMock.mockReturnValue({
      runAsync,
    } as any);

    await setSetting('alarm_type', 'none');

    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      ['alarm_type', 'none'],
    );
  });
});
