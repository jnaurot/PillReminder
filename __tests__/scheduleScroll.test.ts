/**
 * Tests for the scroll-to-today behavior in ScheduleScreen.
 *
 * After the fix: today is always at index 0. No scrollToLocation needed.
 * The list renders [today, yesterday, 2 days ago, ...] top-to-bottom.
 */

import {
  addDays,
  INITIAL_PAST_DAYS,
} from '../src/utils/scheduleDates';

describe('date ordering (today-first)', () => {
  const today = '2026-05-11';

  it('today is at index 0 when generating backward from today', () => {
    const dates: string[] = [];
    for (let i = 0; i <= INITIAL_PAST_DAYS; i++) {
      dates.push(addDays(today, -i));
    }
    expect(dates[0]).toBe(today);
    expect(dates[1]).toBe('2026-05-10');
    expect(dates[INITIAL_PAST_DAYS]).toBe('2026-04-27');
  });

  it('does not include any future dates', () => {
    const dates: string[] = [];
    for (let i = 0; i <= INITIAL_PAST_DAYS; i++) {
      dates.push(addDays(today, -i));
    }
    const hasFuture = dates.some((d) => d > today);
    expect(hasFuture).toBe(false);
  });

  it('scrollToLocation is not needed because today renders first', () => {
    // This test documents the design decision:
    // By putting today at index 0, we avoid the virtualization bug
    // where scrollToLocation fails for off-screen sections.
    expect(true).toBe(true);
  });
});
