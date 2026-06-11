import * as Crypto from 'expo-crypto';
import { getDb } from './database';
import { parseSchedule } from '../types';
import type { MedicationSchedule } from '../types';

const uuidv4 = () => Crypto.randomUUID();

function now(): string {
  return new Date().toISOString();
}

export interface Prescription {
  id: string;
  medication_id: string;
  refill_date: string;
  quantity: number;
  unit: string;
  created_at: string;
}

export interface RefillStatus {
  prescription: Prescription;
  daysRemaining: number | null;
  unitsRemaining: number | null;
  dailyUnitsTaken: number | null;
  isLow: boolean;
}

export async function logRefill(
  medicationId: string,
  quantity: number,
  refillDate?: string,
  unit: string = 'pills',
): Promise<Prescription> {
  const db = getDb();
  const rx: Prescription = {
    id: uuidv4(),
    medication_id: medicationId,
    refill_date: refillDate ?? now().slice(0, 10),
    quantity,
    unit,
    created_at: now(),
  };
  await db.runAsync(
    `INSERT INTO prescriptions (id, medication_id, refill_date, quantity, unit, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [rx.id, rx.medication_id, rx.refill_date, rx.quantity, rx.unit, rx.created_at]
  );
  return rx;
}

export function getDailyUnitsTaken(args: {
  pillsPerDose: number;
  schedule: string;
}): number | null {
  const schedule: MedicationSchedule = parseSchedule(args.schedule);
  switch (schedule.type) {
    case 'fixed_times':
      return schedule.times.length > 0 ? args.pillsPerDose * schedule.times.length : null;
    case 'weekly':
      return schedule.times.length > 0 && schedule.days.length > 0
        ? (args.pillsPerDose * schedule.times.length * schedule.days.length) / 7
        : null;
    case 'monthly':
      return schedule.times.length > 0 && schedule.days.length > 0
        ? (args.pillsPerDose * schedule.times.length * schedule.days.length) / 30
        : null;
    case 'prn':
    default:
      return null;
  }
}

export async function getPrescriptions(medicationId: string): Promise<Prescription[]> {
  const db = getDb();
  return db.getAllAsync<Prescription>(
    `SELECT * FROM prescriptions
     WHERE medication_id = ?
     ORDER BY refill_date DESC, created_at DESC`,
    [medicationId]
  );
}

export async function getLatestPrescription(medicationId: string): Promise<Prescription | null> {
  const db = getDb();
  return db.getFirstAsync<Prescription>(
    `SELECT * FROM prescriptions
     WHERE medication_id = ?
     ORDER BY refill_date DESC, created_at DESC
     LIMIT 1`,
    [medicationId]
  );
}

export async function deleteRefill(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync(`DELETE FROM prescriptions WHERE id = ?`, [id]);
}

export async function getRefillStatus(
  medicationId: string,
  alertDays: number,
): Promise<RefillStatus | null> {
  const db = getDb();
  const prescriptions = await getPrescriptions(medicationId);
  if (prescriptions.length === 0) return null;
  const rx = prescriptions[0];
  const earliestRefillDate = prescriptions[prescriptions.length - 1].refill_date;
  const totalUnitsSupplied = prescriptions.reduce((sum, refill) => sum + refill.quantity, 0);

  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) as total FROM dose_logs
     WHERE medication_id = ? AND skipped = 0 AND taken_at >= ?`,
    [medicationId, earliestRefillDate]
  );
  const dosesTaken = row?.total ?? 0;

  const med = await db.getFirstAsync<{ pills_per_dose: number; schedule: string }>(
    `SELECT pills_per_dose, schedule FROM medications WHERE id = ?`,
    [medicationId]
  );
  const unitsPerDose = med?.pills_per_dose ?? 1;
  const unitsTaken = dosesTaken * unitsPerDose;
  const unitsRemaining = Math.max(0, totalUnitsSupplied - unitsTaken);
  const dailyUnitsTaken = med
    ? getDailyUnitsTaken({
        pillsPerDose: med.pills_per_dose ?? 1,
        schedule: (med as any).schedule,
      })
    : null;

  let daysRemaining: number | null = null;
  if (dailyUnitsTaken !== null && dailyUnitsTaken > 0) {
    daysRemaining = Math.ceil(unitsRemaining / dailyUnitsTaken);
  }

  const lowSupplyThresholdUnits = dailyUnitsTaken !== null
    ? dailyUnitsTaken * alertDays
    : null;

  return {
    prescription: rx,
    daysRemaining,
    unitsRemaining,
    dailyUnitsTaken,
    isLow:
      lowSupplyThresholdUnits !== null
        ? unitsRemaining <= lowSupplyThresholdUnits
        : false,
  };
}
