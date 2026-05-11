/**
 * Regression tests for scheduleDates utilities.
 * Covers: dateStr, addDays, formatHeader, formatSubtitle, buildSection, generateDateWindow
 */

import {
  dateStr,
  addDays,
  formatHeader,
  formatSubtitle,
  buildSection,
  generateDateWindow,
  INITIAL_PAST_DAYS,
  INITIAL_FUTURE_DAYS,
} from '../src/utils/scheduleDates';

describe('dateStr', () => {
  it('formats a Date into YYYY-MM-DD', () => {
    expect(dateStr(new Date('2026-05-11T00:00:00'))).toBe('2026-05-11');
    expect(dateStr(new Date('2024-12-31T00:00:00'))).toBe('2024-12-31');
    expect(dateStr(new Date('2024-01-01T00:00:00'))).toBe('2024-01-01');
  });

  it('pads single-digit months and days', () => {
    expect(dateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateStr(new Date(2026, 11, 1))).toBe('2026-12-01');
  });

  it('handles leap year February', () => {
    expect(dateStr(new Date(2024, 1, 29))).toBe('2024-02-29');
  });

  it('handles year boundary', () => {
    expect(dateStr(new Date(2025, 11, 31))).toBe('2025-12-31');
    expect(dateStr(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});

describe('addDays', () => {
  const may11 = '2026-05-11';

  it('adds zero days (identity)', () => {
    expect(addDays(may11, 0)).toBe('2026-05-11');
  });

  it('adds positive days', () => {
    expect(addDays(may11, 1)).toBe('2026-05-12');
    expect(addDays(may11, 7)).toBe('2026-05-18');
    expect(addDays(may11, 30)).toBe('2026-06-10');
  });

  it('adds negative days', () => {
    expect(addDays(may11, -1)).toBe('2026-05-10');
    expect(addDays(may11, -7)).toBe('2026-05-04');
    expect(addDays(may11, -10)).toBe('2026-05-01');
  });

  it('crosses month boundaries forward', () => {
    expect(addDays('2026-05-31', 1)).toBe('2026-06-01');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
  });

  it('crosses month boundaries backward', () => {
    expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
    expect(addDays('2026-05-01', -1)).toBe('2026-04-30');
  });

  it('crosses year boundary forward', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('crosses year boundary backward', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles leap year boundary', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });

  it('handles large deltas', () => {
    expect(addDays(may11, 365)).toBe('2027-05-11');
    expect(addDays(may11, -365)).toBe('2025-05-11');
  });
});

describe('generateDateWindow', () => {
  const today = '2026-05-11';

  it('places today at the correct offset from the top', () => {
    const dates = generateDateWindow(today, INITIAL_PAST_DAYS, INITIAL_FUTURE_DAYS);
    expect(dates[INITIAL_FUTURE_DAYS]).toBe(today);
  });

  it('has the expected total count', () => {
    const dates = generateDateWindow(today, INITIAL_PAST_DAYS, INITIAL_FUTURE_DAYS);
    expect(dates.length).toBe(INITIAL_PAST_DAYS + INITIAL_FUTURE_DAYS + 1);
  });

  it('orders dates newest-first (descending)', () => {
    const dates = generateDateWindow(today, 2, 2);
    expect(dates).toEqual([
      '2026-05-13',
      '2026-05-12',
      '2026-05-11',
      '2026-05-10',
      '2026-05-09',
    ]);
  });

  it('handles zero future days', () => {
    const dates = generateDateWindow(today, 3, 0);
    expect(dates[0]).toBe(today);
    expect(dates).toEqual(['2026-05-11', '2026-05-10', '2026-05-09', '2026-05-08']);
  });

  it('handles zero past days', () => {
    const dates = generateDateWindow(today, 0, 3);
    expect(dates[dates.length - 1]).toBe(today);
    expect(dates).toEqual(['2026-05-14', '2026-05-13', '2026-05-12', '2026-05-11']);
  });

  it('crosses month boundary', () => {
    const dates = generateDateWindow('2026-05-02', 5, 0);
    expect(dates).toEqual([
      '2026-05-02',
      '2026-05-01',
      '2026-04-30',
      '2026-04-29',
      '2026-04-28',
      '2026-04-27',
    ]);
  });

  it('crosses year boundary', () => {
    const dates = generateDateWindow('2026-01-02', 3, 0);
    expect(dates).toEqual([
      '2026-01-02',
      '2026-01-01',
      '2025-12-31',
      '2025-12-30',
    ]);
  });
});

describe('formatHeader', () => {
  const today = '2026-05-11';

  it('returns "Today" for the current date', () => {
    expect(formatHeader(today, today)).toBe('Today');
  });

  it('returns "Yesterday" for the previous day', () => {
    expect(formatHeader('2026-05-10', today)).toBe('Yesterday');
  });

  it('returns "Tomorrow" for the next day', () => {
    expect(formatHeader('2026-05-12', today)).toBe('Tomorrow');
  });

  it('returns a formatted date for nearby days', () => {
    expect(formatHeader('2026-05-13', today)).toMatch(/May 13/);
  });

  it('returns a formatted date for far future days', () => {
    expect(formatHeader('2026-06-15', today)).toMatch(/Jun/);
  });

  it('returns a formatted date for far past days', () => {
    expect(formatHeader('2025-12-25', today)).toMatch(/Dec/);
  });

  it('handles year boundary correctly', () => {
    expect(formatHeader('2026-01-01', today)).toMatch(/Jan 1/);
  });
});

describe('formatSubtitle', () => {
  it('returns a long-form date with year', () => {
    const result = formatSubtitle('2026-05-11');
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/May/);
    expect(result).toMatch(/11/);
  });

  it('formats year boundary dates', () => {
    const result = formatSubtitle('2026-01-01');
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/Jan/);
  });
});

describe('buildSection', () => {
  const today = '2026-05-11';

  it('marks isToday=true only for today', () => {
    const section = buildSection(today, [], today);
    expect(section.isToday).toBe(true);
    expect(section.isFuture).toBe(false);
    expect(section.isPast).toBe(false);
    expect(section.header).toBe('Today');
  });

  it('marks isFuture=true for future dates', () => {
    const section = buildSection('2026-05-12', [], today);
    expect(section.isToday).toBe(false);
    expect(section.isFuture).toBe(true);
    expect(section.isPast).toBe(false);
  });

  it('marks isPast=true for past dates', () => {
    const section = buildSection('2026-05-10', [], today);
    expect(section.isToday).toBe(false);
    expect(section.isFuture).toBe(false);
    expect(section.isPast).toBe(true);
  });

  it('uses a placeholder when no doses exist', () => {
    const section = buildSection(today, [], today);
    expect(section.data.length).toBe(1);
    expect((section.data[0] as any).isPlaceholder).toBe(true);
  });

  it('uses real doses when they exist', () => {
    const fakeDose = { key: 'x', medication: {} as any, scheduledAt: null, timeLabel: '08:00', log: null, status: 'upcoming' as const, effectiveEarlyWindow: 30, effectiveMissedWindow: 60, effectiveMissedPolicy: 'none' as const, shiftSource: 'local', sharedShiftId: null, entityPrimaryPhone: null };
    const section = buildSection(today, [fakeDose], today);
    expect(section.data.length).toBe(1);
    expect((section.data[0] as any).isPlaceholder).toBeUndefined();
  });

  it('handles far future dates', () => {
    const section = buildSection('2027-01-01', [], today);
    expect(section.isFuture).toBe(true);
    expect(section.isToday).toBe(false);
    expect(section.isPast).toBe(false);
  });

  it('handles far past dates', () => {
    const section = buildSection('2025-01-01', [], today);
    expect(section.isPast).toBe(true);
    expect(section.isToday).toBe(false);
    expect(section.isFuture).toBe(false);
  });

  it('handles year-boundary date', () => {
    const section = buildSection('2026-01-01', [], today);
    expect(section.isPast).toBe(true);
    expect(section.header).toMatch(/Jan 1/);
  });

  it('handles multiple doses', () => {
    const fakeDose1 = { key: 'a', medication: {} as any, scheduledAt: '2026-05-11T08:00:00', timeLabel: '08:00', log: null, status: 'upcoming' as const, effectiveEarlyWindow: 30, effectiveMissedWindow: 60, effectiveMissedPolicy: 'none' as const, shiftSource: 'local', sharedShiftId: null, entityPrimaryPhone: null };
    const fakeDose2 = { key: 'b', medication: {} as any, scheduledAt: '2026-05-11T20:00:00', timeLabel: '20:00', log: null, status: 'upcoming' as const, effectiveEarlyWindow: 30, effectiveMissedWindow: 60, effectiveMissedPolicy: 'none' as const, shiftSource: 'local', sharedShiftId: null, entityPrimaryPhone: null };
    const section = buildSection(today, [fakeDose1, fakeDose2], today);
    expect(section.data.length).toBe(2);
    expect((section.data[0] as any).isPlaceholder).toBeUndefined();
    expect((section.data[1] as any).isPlaceholder).toBeUndefined();
  });
});
