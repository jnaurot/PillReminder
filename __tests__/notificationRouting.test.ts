jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone' },
}));
jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));

import { routeForDoseNotification } from '../src/notifications/scheduler';

describe('notification routing', () => {
  it('routes notifications to Today using the payload scheduled time directly', async () => {
    const route = await routeForDoseNotification('rem-med-123-2026-06-10-0830', {
      medId: 'med-123',
      scheduledAt: '2026-06-10T08:30:00',
      type: 'reminder',
    });

    expect(route).toContain('/today?');
    expect(route).toContain('medId=med-123');
    expect(route).toContain('scheduledAt=2026-06-10T08%3A30%3A00');
    expect(route).toContain('focusToken=');
  });

  it('returns null when the payload does not identify a medication', async () => {
    await expect(
      routeForDoseNotification('refill-med-123', { type: 'refill' }),
    ).resolves.toBeNull();
  });
});
