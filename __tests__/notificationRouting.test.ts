jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone' },
}));

import { getDb } from '../src/db/database';
import {
  routeForDoseNotification,
  shouldDisplayDoseNotification,
} from '../src/notifications/scheduler';

const getDbMock = getDb as jest.MockedFunction<typeof getDb>;

describe('notification routing and suppression', () => {
  beforeEach(() => {
    getDbMock.mockReturnValue({
      getFirstAsync: jest.fn().mockResolvedValue(null),
    } as any);
  });

  it('routes reminder taps to Today with the inferred scheduled time', async () => {
    const route = await routeForDoseNotification(
      'rem-med-123-0830',
      { medId: 'med-123' },
      new Date('2026-06-10T08:30:00'),
    );

    expect(route).toContain('/today?');
    expect(route).toContain('medId=med-123');
    expect(route).toContain('scheduledAt=2026-06-10T08%3A30%3A00');
    expect(route).toContain('focusToken=');
  });

  it('suppresses a completed missed-dose notification', async () => {
    getDbMock.mockReturnValue({
      getFirstAsync: jest.fn().mockResolvedValue({
        skipped: 0,
        taken_at: '2026-06-10T08:05:00',
      }),
    } as any);

    await expect(
      shouldDisplayDoseNotification('miss-med-123-2026-06-10-0800', {
        medId: 'med-123',
        scheduledAt: '2026-06-10T08:00:00',
        type: 'missed',
      }),
    ).resolves.toBe(false);
  });

  it('allows refill reminders through unchanged', async () => {
    await expect(
      shouldDisplayDoseNotification('refill-med-123', {
        medId: 'med-123',
        type: 'refill',
      }),
    ).resolves.toBe(true);
  });
});
