/**
 * Tests for dateTime utilities.
 */

import { dateToStr, todayStr, nDaysAgo, tomorrowStr } from '../src/utils/dateTime';

describe('todayStr', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the current date in YYYY-MM-DD format', () => {
    const fixedDate = new Date(2026, 4, 11, 12, 0, 0); // local noon
    jest.setSystemTime(fixedDate);

    const result = todayStr();
    expect(result).toBe('2026-05-11');
  });

  it('changes when the system date changes', () => {
    jest.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    expect(todayStr()).toBe('2026-01-01');

    jest.setSystemTime(new Date(2026, 11, 31, 12, 0, 0));
    expect(todayStr()).toBe('2026-12-31');
  });
});

describe('dateToStr', () => {
  it('pads single-digit months and days', () => {
    expect(dateToStr(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateToStr(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('tomorrowStr', () => {
  it('returns the day after today', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 4, 11, 12, 0, 0));
    expect(tomorrowStr()).toBe('2026-05-12');
    jest.useRealTimers();
  });
});

describe('nDaysAgo', () => {
  it('returns a Date n days before today at midnight', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 4, 11, 15, 30, 0));

    const result = nDaysAgo(3);
    expect(dateToStr(result)).toBe('2026-05-08');

    const result2 = nDaysAgo(0);
    expect(dateToStr(result2)).toBe('2026-05-11');

    jest.useRealTimers();
  });
});
