/**
 * Tests for the pure date/schedule logic extracted from ScheduleScreen.
 * These verify that:
 * 1. todayStr() returns the expected YYYY-MM-DD format
 * 2. generateDateWindow() puts "today" at the correct index
 * 3. buildSection() correctly flags isToday / isFuture / isPast
 * 4. formatHeader() returns "Today" for today's date
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
});

describe('addDays', () => {
  const may11 = '2026-05-11';

  it('adds days correctly', () => {
    expect(addDays(may11, 0)).toBe('2026-05-11');
    expect(addDays(may11, 1)).toBe('2026-05-12');
    expect(addDays(may11, 7)).toBe('2026-05-18');
    expect(addDays(may11, -1)).toBe('2026-05-10');
    expect(addDays(may11, -7)).toBe('2026-05-04');
  });

  it('crosses month boundaries', () => {
    expect(addDays('2026-05-01', -1)).toBe('2026-04-30');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
  });
});

describe('generateDateWindow', () => {
  const today = '2026-05-11';

  it('places today at the correct offset from the top', () => {
    const dates = generateDateWindow(today, INITIAL_PAST_DAYS, INITIAL_FUTURE_DAYS);
    // Window goes from today+7 down to today-14, so today is at index 7
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

  it('returns a formatted date for other days', () => {
    expect(formatHeader('2026-05-13', today)).toMatch(/May 13/);
  });
});

describe('formatSubtitle', () => {
  it('returns a long-form date', () => {
    const result = formatSubtitle('2026-05-11');
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/May/);
    expect(result).toMatch(/11/);
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
});
