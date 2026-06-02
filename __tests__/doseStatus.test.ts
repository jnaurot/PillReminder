/**
 * Regression tests for getDoseStatus — the core state engine.
 *
 * Boundaries (earlyWindow = 30, missedWindow = 60):
 *   diffMin = (Date.now() - scheduledAt) / 60000
 *   negative diffMin = scheduled is in the future
 *   positive diffMin = scheduled is in the past
 *
 *   diffMin < -30        → locked   (too far ahead)
 *   -30 <= diffMin <= 60 → due      (within early window or at/past scheduled, not missed)
 *   diffMin > 60         → missed   (past missed window)
 */

jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/db/medications', () => ({ getMedications: jest.fn() }));
jest.mock('../src/db/settings', () => ({ getSettings: jest.fn() }));
jest.mock('../src/db/caregivers', () => ({ getActiveShift: jest.fn() }));

import { getDoseStatus } from '../src/db/doseLogs';
import type { DoseLog } from '../src/types';

describe('getDoseStatus — log present', () => {
  it('returns "taken" when log exists and skipped = 0', () => {
    const log: DoseLog = {
      id: '1',
      medication_id: 'm1',
      scheduled_at: '2026-05-11T08:00:00',
      taken_at: '2026-05-11T08:05:00',
      skipped: 0,
      is_catchup: 0,
      notes: null,
      caregiver_id: null,
      created_at: '2026-05-11T08:05:00',
    };
    expect(getDoseStatus('2026-05-11T08:00:00', log, 30, 60)).toBe('taken');
  });

  it('returns "skipped" when log exists and skipped = 1', () => {
    const log: DoseLog = {
      id: '2',
      medication_id: 'm1',
      scheduled_at: '2026-05-11T08:00:00',
      taken_at: null,
      skipped: 1,
      is_catchup: 0,
      notes: null,
      caregiver_id: null,
      created_at: '2026-05-11T08:00:00',
    };
    expect(getDoseStatus('2026-05-11T08:00:00', log, 30, 60)).toBe('skipped');
  });
});

describe('getDoseStatus — PRN (no scheduled time)', () => {
  it('returns "upcoming" when scheduledAt is null and no log', () => {
    expect(getDoseStatus(null, null, 30, 60)).toBe('upcoming');
  });
});

describe('getDoseStatus — scheduled dose boundaries', () => {
  const earlyWindow = 30;
  const missedWindow = 60;

  function makeScheduled(minutesFromNow: number): string {
    const now = new Date('2026-05-11T12:00:00');
    const scheduled = new Date(now.getTime() + minutesFromNow * 60000);
    return scheduled.toISOString();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-11T12:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── Locked (too far ahead, before early window) ──────────────────────────
  it('locked: 31 minutes in the future (just outside early window)', () => {
    const scheduled = makeScheduled(31); // 12:31
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('locked');
  });

  it('locked: 1 year in the future (extreme future)', () => {
    const scheduled = makeScheduled(60 * 24 * 365);
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('locked');
  });

  // ─── Due (within early window or at/past scheduled time, not missed) ─────
  it('due: exactly at the early-window boundary (30 min in future)', () => {
    const scheduled = makeScheduled(30); // 12:30
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('due');
  });

  it('due: 29 minutes in the future (inside early window)', () => {
    const scheduled = makeScheduled(29); // 12:29
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('due');
  });

  it('due: exactly at scheduled time (0 min)', () => {
    const scheduled = makeScheduled(0); // 12:00
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('due');
  });

  it('due: 1 minute past scheduled time', () => {
    const scheduled = makeScheduled(-1); // 11:59
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('due');
  });

  it('due: exactly at the missed-window boundary (60 min past)', () => {
    const scheduled = makeScheduled(-60); // 11:00
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('due');
  });

  it('due: 59 minutes past scheduled time (just inside missed window)', () => {
    const scheduled = makeScheduled(-59); // 11:01
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('due');
  });

  // ─── Missed (past missed window) ──────────────────────────────────────────
  it('missed: 1 minute past the missed-window boundary (61 min past)', () => {
    const scheduled = makeScheduled(-61); // 10:59
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('missed');
  });

  it('missed: 1 day past scheduled time (extreme past)', () => {
    const scheduled = makeScheduled(-60 * 24); // yesterday 12:00
    expect(getDoseStatus(scheduled, null, earlyWindow, missedWindow)).toBe('missed');
  });
});

describe('getDoseStatus — edge-case windows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-11T12:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('zero early window: anything in the future is locked', () => {
    const scheduled = new Date('2026-05-11T12:01:00').toISOString(); // 1 min in future
    expect(getDoseStatus(scheduled, null, 0, 60)).toBe('locked');
  });

  it('zero early window: exactly at scheduled time is due', () => {
    const scheduled = new Date('2026-05-11T12:00:00').toISOString();
    expect(getDoseStatus(scheduled, null, 0, 60)).toBe('due');
  });

  it('zero missed window: 1 second past scheduled time is missed', () => {
    const scheduled = new Date('2026-05-11T11:59:59').toISOString(); // 1 sec in past
    expect(getDoseStatus(scheduled, null, 30, 0)).toBe('missed');
  });

  it('large windows: dose 2 hours early is due', () => {
    const scheduled = new Date('2026-05-11T10:00:00').toISOString(); // 2h in past
    expect(getDoseStatus(scheduled, null, 300, 300)).toBe('due');
  });
});
