export const MSG_VERSION = 1 as const;

export type MessageType =
  | 'SHIFT_INVITE'
  | 'SHIFT_ACCEPT'
  | 'SHIFT_DECLINE'
  | 'DOSE_UPDATE'
  | 'REFILL_UPDATE'
  | 'SHIFT_HANDBACK'
  | 'SHIFT_COMPLETE';

// Minimal entity/medication snapshots embedded in SHIFT_INVITE

export interface MsgEntity {
  id: string;
  name: string;
  dob: string | null;
  notes: string | null;
}

export interface MsgMedication {
  id: string;
  entityId: string;
  name: string;
  dosage: string;
  pillsPerDose: number;
  schedule: string;           // JSON string (MedicationSchedule)
  foodRequirement: string | null;
  interactions: string;       // JSON string (MedicationInteraction[])
  missedPolicy: string | null;
  earlyWindowMinutes: number | null;
  color: string;
  notes: string | null;
}

// ─── Message payloads ─────────────────────────────────────────────────────────

export interface MsgShiftInvite {
  v: typeof MSG_VERSION;
  type: 'SHIFT_INVITE';
  shiftId: string;
  confirmationCode: string;
  startTime: string;
  endTime: string;
  shiftNotes: string | null;
  primaryPhone: string;
  entities: MsgEntity[];
  medications: MsgMedication[];
}

export interface MsgShiftAccept {
  v: typeof MSG_VERSION;
  type: 'SHIFT_ACCEPT';
  shiftId: string;
  confirmationCode: string;
}

export interface MsgShiftDecline {
  v: typeof MSG_VERSION;
  type: 'SHIFT_DECLINE';
  shiftId: string;
  reason: string | null;
}

export interface MsgDoseUpdate {
  v: typeof MSG_VERSION;
  type: 'DOSE_UPDATE';
  shiftId: string;
  entityId: string;
  medicationId: string;
  scheduledAt: string;
  takenAt: string | null;
  skipped: boolean;
  notes: string | null;
}

export interface MsgRefillUpdate {
  v: typeof MSG_VERSION;
  type: 'REFILL_UPDATE';
  shiftId: string;
  entityId: string;
  medicationId: string;
  quantity: number;
  refillDate: string;
  unit: string;
}

export interface MsgShiftHandback {
  v: typeof MSG_VERSION;
  type: 'SHIFT_HANDBACK';
  shiftId: string;
}

export interface MsgShiftComplete {
  v: typeof MSG_VERSION;
  type: 'SHIFT_COMPLETE';
  shiftId: string;
}

export type AnyMessage =
  | MsgShiftInvite
  | MsgShiftAccept
  | MsgShiftDecline
  | MsgDoseUpdate
  | MsgRefillUpdate
  | MsgShiftHandback
  | MsgShiftComplete;
