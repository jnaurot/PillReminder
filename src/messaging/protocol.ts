export const PROTOCOL_VERSION = 1 as const;

export type ProtocolState =
  | 'draft'
  | 'invite_received'
  | 'invite_sent'
  | 'accepted'
  | 'accepted_pending_session'
  | 'active'
  | 'return_sent'
  | 'return_pending_import'
  | 'awaiting_cleanup_ack'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'rejected';

export type ProtocolMessageType =
  | 'SHIFT_INVITE'
  | 'SHIFT_ACCEPT'
  | 'SHIFT_ACTIVATE'
  | 'DOSE_EVENT_BATCH'
  | 'REFILL_EVENT_BATCH'
  | 'SHIFT_RETURN_REQUEST'
  | 'SHIFT_RETURN_ACK'
  | 'SHIFT_COMPLETE_ACK'
  | 'SHIFT_CANCEL'
  | 'SHIFT_REJECT';

export type ProtocolSenderRole = 'primary' | 'alternate';
export type ProtocolPayloadEncoding = 'plaintext' | 'box';

export interface ProtocolEnvelope {
  protocol_version: typeof PROTOCOL_VERSION;
  message_type: ProtocolMessageType;
  shift_id: string;
  transfer_id: string;
  timestamp: string;
  expires_at: string;
  nonce: string;
  sender_role: ProtocolSenderRole;
  sender_device_id: string;
  sender_encryption_public_key: string;
  sender_ephemeral_public_key: string | null;
  recipient_encryption_public_key: string | null;
  payload_encoding: ProtocolPayloadEncoding;
  payload_nonce: string | null;
  payload: string;
}

export interface DelegatedPatientSnapshot {
  patient_id: string;
  name: string;
  dob: string | null;
  notes: string | null;
}

export interface DelegatedMedicationSnapshot {
  medication_id: string;
  patient_id: string;
  name: string;
  dosage: string;
  pills_per_dose: number;
  schedule: string;
  food_requirement: string | null;
  interactions: string;
  missed_policy: string | null;
  early_window_minutes: number | null;
  missed_window_minutes: number | null;
  color: string;
  notes: string | null;
}

export interface ShiftInvitePayload {
  shift_id: string;
  transfer_id: string;
  shift_version: number;
  primary_public_key: string;
  primary_device_id: string;
  primary_phone: string;
  start_time: string;
  end_time: string;
  shift_note: string | null;
  patient_count: number;
  medication_count: number;
}

export interface ShiftAcceptPayload {
  shift_id: string;
  transfer_id: string;
  accepted_at: string;
  invite_nonce: string;
  alternate_public_key: string;
  alternate_device_id: string;
}

export interface ShiftActivatePayload {
  shift_id: string;
  transfer_id: string;
  shift_version: number;
  session_id: string;
  activated_at: string;
  starting_seq: number;
  patients: DelegatedPatientSnapshot[];
  medications: DelegatedMedicationSnapshot[];
}

export type DoseEventType = 'dose_taken' | 'dose_skipped' | 'dose_catchup';

export interface DoseEvent {
  event_id: string;
  seq: number;
  event_type: DoseEventType;
  patient_id: string;
  medication_id: string;
  scheduled_at: string;
  recorded_at: string;
  taken_at: string | null;
  skipped: boolean;
  note: string | null;
}

export interface DoseEventBatchPayload {
  shift_id: string;
  session_id: string;
  events: DoseEvent[];
}

export interface RefillEvent {
  event_id: string;
  seq: number;
  patient_id: string;
  medication_id: string;
  refill_date: string;
  quantity: number;
  unit: string;
  recorded_at: string;
}

export interface RefillEventBatchPayload {
  shift_id: string;
  session_id: string;
  events: RefillEvent[];
}

export interface ShiftReturnRequestPayload {
  shift_id: string;
  session_id: string;
  final_seq: number;
  returned_at: string;
  summary: {
    dose_event_count: number;
    refill_event_count: number;
  };
}

export interface ShiftReturnAckPayload {
  shift_id: string;
  session_id: string;
  acknowledged_at: string;
  final_seq: number;
  import_status: 'complete';
}

export interface ShiftCompleteAckPayload {
  shift_id: string;
  session_id: string;
  cleaned_up_at: string;
  cleanup_status: 'complete';
}

export interface ShiftCancelPayload {
  shift_id: string;
  cancelled_at: string;
  reason: string | null;
}

export interface ShiftRejectPayload {
  shift_id: string;
  transfer_id: string;
  rejected_at: string;
  reason: string | null;
}

export type ProtocolPayload =
  | ShiftInvitePayload
  | ShiftAcceptPayload
  | ShiftActivatePayload
  | DoseEventBatchPayload
  | RefillEventBatchPayload
  | ShiftReturnRequestPayload
  | ShiftReturnAckPayload
  | ShiftCompleteAckPayload
  | ShiftCancelPayload
  | ShiftRejectPayload;

export interface DeviceIdentityRecord {
  device_id: string;
  encryption_public_key: string;
  encryption_private_key: string;
  created_at: string;
}
