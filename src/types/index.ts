// ─── Schedule types ────────────────────────────────────────────────────────

export interface FixedTimesSchedule {
  type: 'fixed_times';
  times: string[]; // 'HH:MM'
}

export interface PrnSchedule {
  type: 'prn';
  max_doses_per_day: number | null;
  min_interval_hours: number | null;
}

export interface WeeklySchedule {
  type: 'weekly';
  days: number[]; // 0=Sun … 6=Sat
  times: string[];
}

export interface MonthlySchedule {
  type: 'monthly';
  days: number[]; // 1–31
  times: string[];
}

export type MedicationSchedule =
  | FixedTimesSchedule
  | PrnSchedule
  | WeeklySchedule
  | MonthlySchedule;

export type ScheduleType = MedicationSchedule['type'];

// ─── Interactions ──────────────────────────────────────────────────────────

export interface WithInteraction {
  type: 'with';
  medication_id: string;
  medication_name: string;
}

export interface HoursAfterInteraction {
  type: 'hours_after';
  medication_id: string;
  medication_name: string;
  hours: number;
}

export type MedicationInteraction = WithInteraction | HoursAfterInteraction;

// ─── Food requirement ──────────────────────────────────────────────────────

export type FoodRequirement = 'with_food' | 'without_food' | null;

// ─── Missed dose policy ────────────────────────────────────────────────────

// null means use global setting
export type MissedPolicy = 'none' | 'catch_up' | 'must_skip' | null;

// ─── Core entities ─────────────────────────────────────────────────────────

export interface Entity {
  id: string;
  name: string;
  dob: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Medication {
  id: string;
  entity_id: string;
  name: string;
  dosage: string;
  pills_per_dose: number;
  schedule: string;                // JSON → MedicationSchedule
  food_requirement: string | null; // 'with_food' | 'without_food' | null
  interactions: string;            // JSON → MedicationInteraction[]
  missed_policy: string | null;    // 'none' | 'catch_up' | 'must_skip' | null
  early_window_minutes: number | null;
  color: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Prescription {
  id: string;
  medication_id: string;
  refill_date: string;
  quantity: number;
  created_at: string;
}

export interface DoseLog {
  id: string;
  medication_id: string;
  scheduled_at: string;
  taken_at: string | null;
  skipped: number;    // 0 | 1
  is_catchup: number; // 0 | 1
  notes: string | null;
  created_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function parseSchedule(json: string): MedicationSchedule {
  try {
    return JSON.parse(json) as MedicationSchedule;
  } catch {
    return { type: 'fixed_times', times: [] };
  }
}

export function parseInteractions(json: string): MedicationInteraction[] {
  try {
    return JSON.parse(json) as MedicationInteraction[];
  } catch {
    return [];
  }
}
