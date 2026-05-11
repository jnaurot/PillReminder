/**
 * Regression tests for dateTime utilities.
 * Covers: todayStr, dateToStr, tomorrowStr, nDaysAgo, nowTimeStr
 */

import { dateToStr, todayStr, nDaysAgo, tomorrowStr, nowTimeStr } from '../src/utils/dateTime';

describe('todayStr', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the current date in YYYY-MM-DD format at local noon', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 12, 0, 0));
    expect(todayStr()).toBe('2026-05-11');
  });

  it('returns correct date just after midnight', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 0, 0, 1));
    expect(todayStr()).toBe('2026-05-11');
  });

  it('returns correct date just before midnight', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 23, 59, 59));
    expect(todayStr()).toBe('2026-05-11');
  });

  it('changes when the system date changes (new year)', () => {
    jest.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    expect(todayStr()).toBe('2026-01-01');
  });

  it('changes when the system date changes (year end)', () => {
    jest.setSystemTime(new Date(2026, 11, 31, 12, 0, 0));
    expect(todayStr()).toBe('2026-12-31');
  });

  it('handles leap year date correctly', () => {
    jest.setSystemTime(new Date(2024, 1, 29, 12, 0, 0));
    expect(todayStr()).toBe('2024-02-29');
  });
});

describe('dateToStr', () => {
  it('pads single-digit months and days', () => {
    expect(dateToStr(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateToStr(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('formats month boundaries correctly', () => {
    expect(dateToStr(new Date(2026, 0, 31))).toBe('2026-01-31'); // Jan 31
    expect(dateToStr(new Date(2026, 1, 28))).toBe('2026-02-28'); // Feb 28
    expect(dateToStr(new Date(2024, 1, 29))).toBe('2024-02-29'); // Leap year Feb 29
    expect(dateToStr(new Date(2026, 2, 31))).toBe('2026-03-31'); // Mar 31
    expect(dateToStr(new Date(2026, 3, 30))).toBe('2026-04-30'); // Apr 30
  });

  it('formats year boundaries correctly', () => {
    expect(dateToStr(new Date(2026, 0, 1))).toBe('2026-01-01');  // New year
    expect(dateToStr(new Date(2025, 11, 31))).toBe('2025-12-31'); // Year end
  });

  it('handles single-digit years in 21st century', () => {
    expect(dateToStr(new Date(2001, 0, 1))).toBe('2001-01-01');
  });
});

describe('tomorrowStr', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the day after today', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 12, 0, 0));
    expect(tomorrowStr()).toBe('2026-05-12');
  });

  it('crosses month boundary', () => {
    jest.setSystemTime(new Date(2026, 4, 31, 12, 0, 0));
    expect(tomorrowStr()).toBe('2026-06-01');
  });

  it('crosses year boundary', () => {
    jest.setSystemTime(new Date(2026, 11, 31, 12, 0, 0));
    expect(tomorrowStr()).toBe('2027-01-01');
  });
});

describe('nDaysAgo', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns today when n = 0', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 15, 30, 0));
    const result = nDaysAgo(0);
    expect(dateToStr(result)).toBe('2026-05-11');
  });

  it('returns n days before today', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 15, 30, 0));
    expect(dateToStr(nDaysAgo(3))).toBe('2026-05-08');
    expect(dateToStr(nDaysAgo(7))).toBe('2026-05-04');
    expect(dateToStr(nDaysAgo(14))).toBe('2026-04-27');
  });

  it('crosses month boundary', () => {
    jest.setSystemTime(new Date(2026, 4, 2, 12, 0, 0));
    expect(dateToStr(nDaysAgo(3))).toBe('2026-04-29');
  });

  it('crosses year boundary', () => {
    jest.setSystemTime(new Date(2026, 0, 3, 12, 0, 0));
    expect(dateToStr(nDaysAgo(5))).toBe('2025-12-29');
  });

  it('returns time at midnight', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 15, 30, 45));
    const result = nDaysAgo(1);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });
});

describe('nowTimeStr', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns HH:MM at midnight', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 0, 0, 0));
    expect(nowTimeStr()).toBe('00:00');
  });

  it('returns HH:MM at noon', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 12, 30, 0));
    expect(nowTimeStr()).toBe('12:30');
  });

  it('returns HH:MM just before midnight', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 23, 59, 59));
    expect(nowTimeStr()).toBe('23:59');
  });

  it('pads single-digit hours and minutes', () => {
    jest.setSystemTime(new Date(2026, 4, 11, 1, 5, 0));
    expect(nowTimeStr()).toBe('01:05');
  });
});
