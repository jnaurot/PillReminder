import type { ScheduledDose } from '../db/doseLogs';

// ─── Date helpers ───────────────────────────────────────────────────────────

export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return dateStr(d);
}

export function formatHeader(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatSubtitle(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type Placeholder = { key: string; dateStr: string; isPlaceholder: true };

export type SectionItem = ScheduledDose | Placeholder;

export type ScheduleSection = {
  dateStr: string;
  header: string;
  subHeader: string;
  data: SectionItem[];
  isToday: boolean;
  isFuture: boolean;
  isPast: boolean;
};

// ─── Constants ──────────────────────────────────────────────────────────────

export const INITIAL_PAST_DAYS = 14;
export const INITIAL_FUTURE_DAYS = 7;
export const LOAD_MORE_BATCH = 14;

// ─── Section builder ─────────────────────────────────────────────────────────

export function buildSection(
  dateStrVal: string,
  doses: ScheduledDose[],
  today: string,
): ScheduleSection {
  const isToday = dateStrVal === today;
  const isFuture = dateStrVal > today;
  const isPast = dateStrVal < today;

  const data: SectionItem[] =
    doses.length > 0
      ? doses
      : [{ key: `empty-${dateStrVal}`, dateStr: dateStrVal, isPlaceholder: true }];

  return {
    dateStr: dateStrVal,
    header: formatHeader(dateStrVal, today),
    subHeader: formatSubtitle(dateStrVal),
    data,
    isToday,
    isFuture,
    isPast,
  };
}

// ─── Date window generator (pure) ────────────────────────────────────────────

export function generateDateWindow(center: string, pastDays: number, futureDays: number): string[] {
  const dates: string[] = [];
  for (let i = futureDays; i >= -pastDays; i--) {
    dates.push(addDays(center, i));
  }
  return dates;
}
