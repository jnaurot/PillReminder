import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { getDb } from '../db/database';
import type { Medication } from '../types';
import type {
  DelegatedMedicationSnapshot,
  DelegatedPatientSnapshot,
  DeviceIdentityRecord,
  DoseEvent,
  DoseEventBatchPayload,
  ProtocolEnvelope,
  ProtocolMessageType,
  ProtocolPayload,
  ProtocolPayloadEncoding,
  ProtocolSenderRole,
  ProtocolState,
  RefillEvent,
  RefillEventBatchPayload,
  ShiftAcceptPayload,
  ShiftActivatePayload,
  ShiftCancelPayload,
  ShiftCompleteAckPayload,
  ShiftInvitePayload,
  ShiftRejectPayload,
  ShiftReturnAckPayload,
  ShiftReturnRequestPayload,
} from './protocol';
import { PROTOCOL_VERSION } from './protocol';

const now = () => new Date().toISOString();
const uuidv4 = () => Crypto.randomUUID();

type ShiftRow = {
  id: string;
  transfer_id: string | null;
  protocol_state: ProtocolState;
  shift_version: number;
  session_id: string | null;
  entity_ids: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  primary_phone: string;
  primary_device_id: string | null;
  alternate_device_id: string | null;
  primary_identity_key: string | null;
  alternate_identity_key: string | null;
  invite_nonce: string | null;
  final_seq: number | null;
  last_applied_seq: number;
};

type EntityRow = {
  id: string;
  name: string;
  dob: string | null;
  notes: string | null;
};

type DbLike = ReturnType<typeof getDb>;

function encodeB64(input: Uint8Array): string {
  return naclUtil.encodeBase64(input);
}

function decodeB64(input: string): Uint8Array {
  return naclUtil.decodeBase64(input);
}

function encodeJson(payload: ProtocolPayload): Uint8Array {
  return naclUtil.decodeUTF8(JSON.stringify(payload));
}

function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(naclUtil.encodeUTF8(bytes)) as T;
}

function randomB64(bytes = 24): string {
  return encodeB64(nacl.randomBytes(bytes));
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

function plaintextEnvelope(
  messageType: ProtocolMessageType,
  senderRole: ProtocolSenderRole,
  senderDeviceId: string,
  senderPublicKey: string,
  shiftId: string,
  transferId: string,
  payload: ProtocolPayload,
  expiresAt: string,
): ProtocolEnvelope {
  return {
    protocol_version: PROTOCOL_VERSION,
    message_type: messageType,
    shift_id: shiftId,
    transfer_id: transferId,
    timestamp: now(),
    expires_at: expiresAt,
    nonce: randomB64(),
    sender_role: senderRole,
    sender_device_id: senderDeviceId,
    sender_encryption_public_key: senderPublicKey,
    sender_ephemeral_public_key: null,
    recipient_encryption_public_key: null,
    payload_encoding: 'plaintext',
    payload_nonce: null,
    payload: naclUtil.encodeBase64(encodeJson(payload)),
  };
}

function boxEnvelope(
  messageType: ProtocolMessageType,
  senderRole: ProtocolSenderRole,
  senderDeviceId: string,
  senderPublicKey: string,
  senderSecretKey: string,
  recipientPublicKey: string,
  shiftId: string,
  transferId: string,
  payload: ProtocolPayload,
  expiresAt: string,
  senderEphemeralPublicKey: string | null = null,
): ProtocolEnvelope {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const cipher = nacl.box(
    encodeJson(payload),
    nonce,
    decodeB64(recipientPublicKey),
    decodeB64(senderSecretKey),
  );
  return {
    protocol_version: PROTOCOL_VERSION,
    message_type: messageType,
    shift_id: shiftId,
    transfer_id: transferId,
    timestamp: now(),
    expires_at: expiresAt,
    nonce: randomB64(),
    sender_role: senderRole,
    sender_device_id: senderDeviceId,
    sender_encryption_public_key: senderPublicKey,
    sender_ephemeral_public_key: senderEphemeralPublicKey,
    recipient_encryption_public_key: recipientPublicKey,
    payload_encoding: 'box',
    payload_nonce: encodeB64(nonce),
    payload: encodeB64(cipher),
  };
}

function decodePlaintextPayload<T extends ProtocolPayload>(envelope: ProtocolEnvelope): T {
  return JSON.parse(naclUtil.encodeUTF8(decodeB64(envelope.payload))) as T;
}

export function readPlaintextProtocolPayload<T extends ProtocolPayload>(envelope: ProtocolEnvelope): T {
  if (envelope.payload_encoding !== 'plaintext') {
    throw new Error('Protocol payload is not plaintext.');
  }
  return decodePlaintextPayload<T>(envelope);
}

function decodeBoxPayload<T extends ProtocolPayload>(
  envelope: ProtocolEnvelope,
  recipientPrivateKey: string,
  senderPublicKey: string,
): T {
  if (!envelope.payload_nonce) throw new Error('Missing payload nonce.');
  const opened = nacl.box.open(
    decodeB64(envelope.payload),
    decodeB64(envelope.payload_nonce),
    decodeB64(senderPublicKey),
    decodeB64(recipientPrivateKey),
  );
  if (!opened) throw new Error('Could not decrypt payload.');
  return decodeJson<T>(opened);
}

async function getShift(db: DbLike, shiftId: string): Promise<ShiftRow | null> {
  return db.getFirstAsync<ShiftRow>(
    `SELECT id, transfer_id, protocol_state, shift_version, session_id, entity_ids,
            start_time, end_time, notes, primary_phone, primary_device_id,
            alternate_device_id, primary_identity_key, alternate_identity_key,
            invite_nonce, final_seq, last_applied_seq
       FROM caregiver_shifts WHERE id = ?`,
    [shiftId],
  );
}

async function getOrCreateDeviceIdentity(): Promise<DeviceIdentityRecord> {
  const db = getDb();
  const existing = await db.getFirstAsync<DeviceIdentityRecord>(
    'SELECT * FROM device_identity ORDER BY created_at ASC LIMIT 1',
  );
  if (existing) return existing;
  const kp = nacl.box.keyPair();
  const identity: DeviceIdentityRecord = {
    device_id: uuidv4(),
    encryption_public_key: encodeB64(kp.publicKey),
    encryption_private_key: encodeB64(kp.secretKey),
    created_at: now(),
  };
  await db.runAsync(
    `INSERT INTO device_identity (device_id, encryption_public_key, encryption_private_key, created_at)
     VALUES (?, ?, ?, ?)`,
    [identity.device_id, identity.encryption_public_key, identity.encryption_private_key, identity.created_at],
  );
  return identity;
}

async function ensureUniqueNonce(db: DbLike, envelope: ProtocolEnvelope): Promise<void> {
  const existing = await db.getFirstAsync<{ nonce: string }>(
    'SELECT nonce FROM protocol_message_receipts WHERE nonce = ?',
    [envelope.nonce],
  );
  if (existing) throw new Error('Duplicate protocol nonce.');
}

async function recordMessageReceipt(
  db: DbLike,
  envelope: ProtocolEnvelope,
  status: 'accepted' | 'rejected' | 'duplicate' | 'expired',
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO protocol_message_receipts
       (id, shift_id, message_type, nonce, sender_identity_key, received_at, expires_at, signature_valid, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      envelope.shift_id,
      envelope.message_type,
      envelope.nonce,
      envelope.sender_encryption_public_key,
      now(),
      envelope.expires_at,
      1,
      status,
    ],
  );
}

async function getMedicationAndEntity(
  db: DbLike,
  medicationId: string,
): Promise<{ medication: Medication; entity_id: string } | null> {
  const row = await db.getFirstAsync<Medication>(
    'SELECT * FROM medications WHERE id = ?',
    [medicationId],
  );
  if (!row) return null;
  return { medication: row, entity_id: row.entity_id };
}

function entityIdAllowed(entityIdsJson: string, entityId: string): boolean {
  const ids = JSON.parse(entityIdsJson) as string[];
  return ids.includes('*') || ids.includes(entityId);
}

async function importDelegatedSnapshot(
  db: DbLike,
  shift: ShiftRow,
  payload: ShiftActivatePayload,
): Promise<void> {
  for (const patient of payload.patients) {
    await db.runAsync(
      `INSERT OR REPLACE INTO entities
         (id, name, dob, notes, shift_source, shared_shift_id, primary_phone,
          delegation_owner_device_id, delegation_imported_at, delegation_expires_at,
          delegation_cleanup_pending, delegation_version, delegation_source_transfer_id,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 'shared', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        patient.patient_id,
        patient.name,
        patient.dob,
        patient.notes,
        shift.id,
        shift.primary_phone,
        shift.primary_device_id,
        payload.activated_at,
        shift.end_time,
        payload.shift_version,
        shift.transfer_id,
        now(),
        now(),
      ],
    );
  }

  for (const medication of payload.medications) {
    await db.runAsync(
      `INSERT OR REPLACE INTO medications
         (id, entity_id, name, dosage, pills_per_dose, schedule, food_requirement,
          interactions, missed_policy, early_window_minutes, missed_window_minutes,
          color, notes, shared_shift_id, delegation_imported_at,
          delegation_cleanup_pending, delegation_version, delegation_source_transfer_id,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        medication.medication_id,
        medication.patient_id,
        medication.name,
        medication.dosage,
        medication.pills_per_dose,
        medication.schedule,
        medication.food_requirement,
        medication.interactions,
        medication.missed_policy,
        medication.early_window_minutes,
        medication.missed_window_minutes,
        medication.color,
        medication.notes,
        shift.id,
        payload.activated_at,
        payload.shift_version,
        shift.transfer_id,
        now(),
        now(),
      ],
    );
  }
}

async function deleteDelegatedSnapshot(db: DbLike, shiftId: string): Promise<void> {
  await db.runAsync(
    `DELETE FROM dose_logs WHERE medication_id IN (
       SELECT id FROM medications WHERE shared_shift_id = ?
     )`,
    [shiftId],
  );
  await db.runAsync(
    `DELETE FROM prescriptions WHERE medication_id IN (
       SELECT id FROM medications WHERE shared_shift_id = ?
     )`,
    [shiftId],
  );
  await db.runAsync('DELETE FROM refill_events WHERE shift_id = ?', [shiftId]);
  await db.runAsync('DELETE FROM medications WHERE shared_shift_id = ?', [shiftId]);
  await db.runAsync('DELETE FROM entities WHERE shared_shift_id = ?', [shiftId]);
}

export async function createShiftInviteEnvelope(args: {
  shiftId: string;
  transferId: string;
  primaryPhone: string;
  startTime: string;
  endTime: string;
  shiftVersion: number;
  shiftNote: string | null;
  patientCount: number;
  medicationCount: number;
  expiresAt: string;
}): Promise<ProtocolEnvelope> {
  const db = getDb();
  const identity = await getOrCreateDeviceIdentity();
  await db.runAsync(
    `UPDATE caregiver_shifts
        SET transfer_id = ?, protocol_state = 'invite_sent', shift_version = ?,
            primary_device_id = ?, primary_identity_key = ?, invite_nonce = ?, primary_phone = ?
      WHERE id = ?`,
    [
      args.transferId,
      args.shiftVersion,
      identity.device_id,
      identity.encryption_public_key,
      '',
      args.primaryPhone,
      args.shiftId,
    ],
  );
  const payload: ShiftInvitePayload = {
    shift_id: args.shiftId,
    transfer_id: args.transferId,
    shift_version: args.shiftVersion,
    primary_public_key: identity.encryption_public_key,
    primary_device_id: identity.device_id,
    primary_phone: args.primaryPhone,
    start_time: args.startTime,
    end_time: args.endTime,
    shift_note: args.shiftNote,
    patient_count: args.patientCount,
    medication_count: args.medicationCount,
  };
  const envelope = plaintextEnvelope(
    'SHIFT_INVITE',
    'primary',
    identity.device_id,
    identity.encryption_public_key,
    args.shiftId,
    args.transferId,
    payload,
    args.expiresAt,
  );
  await db.runAsync(
    'UPDATE caregiver_shifts SET invite_nonce = ? WHERE id = ?',
    [envelope.nonce, args.shiftId],
  );
  return envelope;
}

export async function createShiftAcceptEnvelope(invite: ProtocolEnvelope): Promise<ProtocolEnvelope> {
  if (invite.message_type !== 'SHIFT_INVITE') throw new Error('Expected SHIFT_INVITE.');
  const invitePayload = decodePlaintextPayload<ShiftInvitePayload>(invite);
  const db = getDb();
  const identity = await getOrCreateDeviceIdentity();
  const ephemeral = nacl.box.keyPair();
  const payload: ShiftAcceptPayload = {
    shift_id: invite.shift_id,
    transfer_id: invite.transfer_id,
    accepted_at: now(),
    invite_nonce: invite.nonce,
    alternate_public_key: identity.encryption_public_key,
    alternate_device_id: identity.device_id,
  };
  await db.runAsync(
    `INSERT OR REPLACE INTO shift_peer_keys
       (shift_id, peer_role, peer_identity_key, peer_ephemeral_key, established_at)
     VALUES (?, 'primary', ?, ?, ?)`,
    [invite.shift_id, invitePayload.primary_public_key, invitePayload.primary_public_key, now()],
  );
  return boxEnvelope(
    'SHIFT_ACCEPT',
    'alternate',
    identity.device_id,
    encodeB64(ephemeral.publicKey),
    encodeB64(ephemeral.secretKey),
    invitePayload.primary_public_key,
    invite.shift_id,
    invite.transfer_id,
    payload,
    invite.expires_at,
    encodeB64(ephemeral.publicKey),
  );
}

export async function createShiftActivateEnvelope(args: {
  shiftId: string;
  transferId: string;
  sessionId: string;
  shiftVersion: number;
  startSeq?: number;
  patients: DelegatedPatientSnapshot[];
  medications: DelegatedMedicationSnapshot[];
  expiresAt: string;
}): Promise<ProtocolEnvelope> {
  const db = getDb();
  const shift = await getShift(db, args.shiftId);
  if (!shift) throw new Error('Shift not found.');
  if (!shift.alternate_identity_key) throw new Error('Alternate key not established.');
  const identity = await getOrCreateDeviceIdentity();
  const payload: ShiftActivatePayload = {
    shift_id: args.shiftId,
    transfer_id: args.transferId,
    shift_version: args.shiftVersion,
    session_id: args.sessionId,
    activated_at: now(),
    starting_seq: args.startSeq ?? 1,
    patients: args.patients,
    medications: args.medications,
  };
  await db.runAsync(
    `UPDATE caregiver_shifts
        SET session_id = ?, protocol_state = 'active', activated_at = ?, shift_version = ?
      WHERE id = ?`,
    [args.sessionId, payload.activated_at, args.shiftVersion, args.shiftId],
  );
  return boxEnvelope(
    'SHIFT_ACTIVATE',
    'primary',
    identity.device_id,
    identity.encryption_public_key,
    identity.encryption_private_key,
    shift.alternate_identity_key,
    args.shiftId,
    args.transferId,
    payload,
    args.expiresAt,
  );
}

export async function createDoseEventBatchEnvelope(args: {
  shiftId: string;
  transferId: string;
  sessionId: string;
  events: DoseEvent[];
  expiresAt: string;
}): Promise<ProtocolEnvelope> {
  const db = getDb();
  const shift = await getShift(db, args.shiftId);
  if (!shift?.primary_identity_key) throw new Error('Primary key missing.');
  const identity = await getOrCreateDeviceIdentity();
  const payload: DoseEventBatchPayload = {
    shift_id: args.shiftId,
    session_id: args.sessionId,
    events: args.events,
  };
  return boxEnvelope(
    'DOSE_EVENT_BATCH',
    'alternate',
    identity.device_id,
    identity.encryption_public_key,
    identity.encryption_private_key,
    shift.primary_identity_key,
    args.shiftId,
    args.transferId,
    payload,
    args.expiresAt,
  );
}

export async function createRefillEventBatchEnvelope(args: {
  shiftId: string;
  transferId: string;
  sessionId: string;
  events: RefillEvent[];
  expiresAt: string;
}): Promise<ProtocolEnvelope> {
  const db = getDb();
  const shift = await getShift(db, args.shiftId);
  if (!shift?.primary_identity_key) throw new Error('Primary key missing.');
  const identity = await getOrCreateDeviceIdentity();
  const payload: RefillEventBatchPayload = {
    shift_id: args.shiftId,
    session_id: args.sessionId,
    events: args.events,
  };
  return boxEnvelope(
    'REFILL_EVENT_BATCH',
    'alternate',
    identity.device_id,
    identity.encryption_public_key,
    identity.encryption_private_key,
    shift.primary_identity_key,
    args.shiftId,
    args.transferId,
    payload,
    args.expiresAt,
  );
}

export async function createShiftReturnRequestEnvelope(args: {
  shiftId: string;
  transferId: string;
  sessionId: string;
  finalSeq: number;
  doseEventCount: number;
  refillEventCount: number;
  expiresAt: string;
}): Promise<ProtocolEnvelope> {
  const db = getDb();
  const shift = await getShift(db, args.shiftId);
  if (!shift?.primary_identity_key) throw new Error('Primary key missing.');
  const identity = await getOrCreateDeviceIdentity();
  const payload: ShiftReturnRequestPayload = {
    shift_id: args.shiftId,
    session_id: args.sessionId,
    final_seq: args.finalSeq,
    returned_at: now(),
    summary: {
      dose_event_count: args.doseEventCount,
      refill_event_count: args.refillEventCount,
    },
  };
  await db.runAsync(
    `UPDATE caregiver_shifts SET protocol_state = 'return_sent', final_seq = ?, return_requested_at = ?
      WHERE id = ?`,
    [args.finalSeq, payload.returned_at, args.shiftId],
  );
  return boxEnvelope(
    'SHIFT_RETURN_REQUEST',
    'alternate',
    identity.device_id,
    identity.encryption_public_key,
    identity.encryption_private_key,
    shift.primary_identity_key,
    args.shiftId,
    args.transferId,
    payload,
    args.expiresAt,
  );
}

export async function createShiftReturnAckEnvelope(args: {
  shiftId: string;
  transferId: string;
  sessionId: string;
  finalSeq: number;
  expiresAt: string;
}): Promise<ProtocolEnvelope> {
  const db = getDb();
  const shift = await getShift(db, args.shiftId);
  if (!shift?.alternate_identity_key) throw new Error('Alternate key missing.');
  const identity = await getOrCreateDeviceIdentity();
  const payload: ShiftReturnAckPayload = {
    shift_id: args.shiftId,
    session_id: args.sessionId,
    acknowledged_at: now(),
    final_seq: args.finalSeq,
    import_status: 'complete',
  };
  await db.runAsync(
    `UPDATE caregiver_shifts
        SET protocol_state = 'return_pending_import', return_acked_at = ?
      WHERE id = ?`,
    [payload.acknowledged_at, args.shiftId],
  );
  return boxEnvelope(
    'SHIFT_RETURN_ACK',
    'primary',
    identity.device_id,
    identity.encryption_public_key,
    identity.encryption_private_key,
    shift.alternate_identity_key,
    args.shiftId,
    args.transferId,
    payload,
    args.expiresAt,
  );
}

export async function createShiftCompleteAckEnvelope(args: {
  shiftId: string;
  transferId: string;
  sessionId: string;
  expiresAt: string;
}): Promise<ProtocolEnvelope> {
  const db = getDb();
  const shift = await getShift(db, args.shiftId);
  if (!shift?.primary_identity_key) throw new Error('Primary key missing.');
  const identity = await getOrCreateDeviceIdentity();
  const payload: ShiftCompleteAckPayload = {
    shift_id: args.shiftId,
    session_id: args.sessionId,
    cleaned_up_at: now(),
    cleanup_status: 'complete',
  };
  return boxEnvelope(
    'SHIFT_COMPLETE_ACK',
    'alternate',
    identity.device_id,
    identity.encryption_public_key,
    identity.encryption_private_key,
    shift.primary_identity_key,
    args.shiftId,
    args.transferId,
    payload,
    args.expiresAt,
  );
}

export async function createShiftRejectEnvelope(invite: ProtocolEnvelope, reason: string | null): Promise<ProtocolEnvelope> {
  if (invite.message_type !== 'SHIFT_INVITE') throw new Error('Expected SHIFT_INVITE.');
  const invitePayload = decodePlaintextPayload<ShiftInvitePayload>(invite);
  const identity = await getOrCreateDeviceIdentity();
  const payload: ShiftRejectPayload = {
    shift_id: invite.shift_id,
    transfer_id: invite.transfer_id,
    rejected_at: now(),
    reason,
  };
  return boxEnvelope(
    'SHIFT_REJECT',
    'alternate',
    identity.device_id,
    identity.encryption_public_key,
    identity.encryption_private_key,
    invitePayload.primary_public_key,
    invite.shift_id,
    invite.transfer_id,
    payload,
    invite.expires_at,
  );
}

export async function createShiftCancelEnvelope(args: {
  shiftId: string;
  transferId: string;
  reason: string | null;
  expiresAt: string;
}): Promise<ProtocolEnvelope> {
  const db = getDb();
  const shift = await getShift(db, args.shiftId);
  if (!shift?.alternate_identity_key) throw new Error('Alternate key not established.');
  const identity = await getOrCreateDeviceIdentity();
  const payload: ShiftCancelPayload = {
    shift_id: args.shiftId,
    cancelled_at: now(),
    reason: args.reason,
  };
  return boxEnvelope(
    'SHIFT_CANCEL',
    'primary',
    identity.device_id,
    identity.encryption_public_key,
    identity.encryption_private_key,
    shift.alternate_identity_key,
    args.shiftId,
    args.transferId,
    payload,
    args.expiresAt,
  );
}

export async function buildShiftDelegatedSnapshot(shiftId: string): Promise<{
  patients: DelegatedPatientSnapshot[];
  medications: DelegatedMedicationSnapshot[];
}> {
  const db = getDb();
  const shift = await getShift(db, shiftId);
  if (!shift) throw new Error('Shift not found.');
  const rawIds = JSON.parse(shift.entity_ids) as string[];
  const includeAll = rawIds.includes('*');
  const patients = includeAll
    ? await db.getAllAsync<EntityRow>(
      'SELECT id, name, dob, notes FROM entities WHERE deleted_at IS NULL ORDER BY name ASC',
    )
    : await db.getAllAsync<EntityRow>(
      `SELECT id, name, dob, notes
         FROM entities
        WHERE deleted_at IS NULL
          AND id IN (${rawIds.map(() => '?').join(', ')})
        ORDER BY name ASC`,
      rawIds,
    );

  const medications: Medication[] = patients.length === 0
    ? []
    : await db.getAllAsync<Medication>(
      `SELECT *
         FROM medications
        WHERE deleted_at IS NULL
          AND entity_id IN (${patients.map(() => '?').join(', ')})
        ORDER BY name ASC`,
      patients.map((patient) => patient.id),
    );

  return {
    patients: patients.map((patient) => ({
      patient_id: patient.id,
      name: patient.name,
      dob: patient.dob,
      notes: patient.notes,
    })),
    medications: medications.map((medication) => ({
      medication_id: medication.id,
      patient_id: medication.entity_id,
      name: medication.name,
      dosage: medication.dosage,
      pills_per_dose: medication.pills_per_dose,
      schedule: medication.schedule,
      food_requirement: medication.food_requirement,
      interactions: medication.interactions,
      missed_policy: medication.missed_policy,
      early_window_minutes: medication.early_window_minutes,
      missed_window_minutes: medication.missed_window_minutes,
      color: medication.color,
      notes: medication.notes,
    })),
  };
}

export async function getShiftTransportContext(shiftId: string): Promise<{
  shiftId: string;
  transferId: string;
  sessionId: string;
  primaryPhone: string;
}> {
  const shift = await getShift(getDb(), shiftId);
  if (!shift?.transfer_id) throw new Error('Shift transfer not established.');
  if (!shift.session_id) throw new Error('Shift session not established.');
  if (!shift.primary_phone) throw new Error('Primary phone number missing.');
  return {
    shiftId,
    transferId: shift.transfer_id,
    sessionId: shift.session_id,
    primaryPhone: shift.primary_phone,
  };
}

export async function getNextProtocolEventSeq(shiftId: string): Promise<number> {
  const db = getDb();
  const doseRow = await db.getFirstAsync<{ seq: number | null }>(
    'SELECT MAX(protocol_seq) AS seq FROM dose_logs WHERE protocol_shift_id = ?',
    [shiftId],
  );
  const refillRow = await db.getFirstAsync<{ seq: number | null }>(
    'SELECT MAX(seq) AS seq FROM refill_events WHERE shift_id = ?',
    [shiftId],
  );
  return Math.max(doseRow?.seq ?? 0, refillRow?.seq ?? 0) + 1;
}

export async function annotateDoseLogProtocolEvent(args: {
  medicationId: string;
  scheduledAt: string;
  eventId: string;
  shiftId: string;
  seq: number;
  recordedAt: string;
}): Promise<void> {
  await getDb().runAsync(
    `UPDATE dose_logs
        SET protocol_event_id = ?, protocol_shift_id = ?, protocol_seq = ?,
            protocol_sender_role = 'alternate', protocol_recorded_at = ?, protocol_applied_at = ?
      WHERE medication_id = ? AND scheduled_at = ?`,
    [
      args.eventId,
      args.shiftId,
      args.seq,
      args.recordedAt,
      now(),
      args.medicationId,
      args.scheduledAt,
    ],
  );
}

export async function recordOutgoingRefillProtocolEvent(args: {
  eventId: string;
  shiftId: string;
  medicationId: string;
  seq: number;
  quantity: number;
  refillDate: string;
  daysSupply: number | null;
  unit: string;
  recordedAt: string;
}): Promise<void> {
  await getDb().runAsync(
    `INSERT INTO refill_events
       (id, protocol_event_id, shift_id, medication_id, seq, quantity, refill_date, days_supply, unit, recorded_at, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      args.eventId,
      args.shiftId,
      args.medicationId,
      args.seq,
      args.quantity,
      args.refillDate,
      args.daysSupply,
      args.unit,
      args.recordedAt,
      now(),
    ],
  );
}

export async function summarizeOutgoingShiftEvents(shiftId: string): Promise<{
  finalSeq: number;
  doseEventCount: number;
  refillEventCount: number;
}> {
  const db = getDb();
  const doseRow = await db.getFirstAsync<{ count: number; max_seq: number | null }>(
    `SELECT COUNT(*) AS count, MAX(protocol_seq) AS max_seq
       FROM dose_logs
      WHERE protocol_shift_id = ?`,
    [shiftId],
  );
  const refillRow = await db.getFirstAsync<{ count: number; max_seq: number | null }>(
    `SELECT COUNT(*) AS count, MAX(seq) AS max_seq
       FROM refill_events
      WHERE shift_id = ?`,
    [shiftId],
  );
  return {
    finalSeq: Math.max(doseRow?.max_seq ?? 0, refillRow?.max_seq ?? 0),
    doseEventCount: doseRow?.count ?? 0,
    refillEventCount: refillRow?.count ?? 0,
  };
}

export async function processProtocolEnvelope(envelope: ProtocolEnvelope): Promise<{ ok: true; action: string } | { ok: false; error: string }> {
  const db = getDb();
  try {
    if (envelope.protocol_version !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version.');
    if (isExpired(envelope.expires_at)) {
      await recordMessageReceipt(db, envelope, 'expired');
      throw new Error('Protocol message expired.');
    }
    await ensureUniqueNonce(db, envelope);

    const identity = await getOrCreateDeviceIdentity();

    if (envelope.message_type === 'SHIFT_INVITE') {
      const payload = decodePlaintextPayload<ShiftInvitePayload>(envelope);
      const existing = await getShift(db, payload.shift_id);
      if (existing && ['completed', 'cancelled', 'expired', 'rejected'].includes(existing.protocol_state)) {
        throw new Error('Cannot import records for an inactive shift.');
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO caregivers (id, name, phone, created_at)
         VALUES (?, ?, ?, ?)`,
        [payload.primary_device_id, 'Primary caregiver', '', now()],
      );
      await db.runAsync(
        `INSERT OR REPLACE INTO caregiver_shifts
           (id, caregiver_id, entity_ids, start_time, end_time, status, protocol_state,
            transfer_id, shift_version, primary_device_id, primary_identity_key,
            invite_nonce, confirmation_code, notes, primary_phone, created_at)
         VALUES (?, ?, '[]', ?, ?, 'pending', 'invite_received', ?, ?, ?, ?, ?, '', ?, ?, ?)`,
        [
          payload.shift_id,
          payload.primary_device_id,
          payload.start_time,
          payload.end_time,
          payload.transfer_id,
          payload.shift_version,
          payload.primary_device_id,
          payload.primary_public_key,
          envelope.nonce,
          payload.shift_note,
          payload.primary_phone,
          now(),
        ],
      );
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'shift_invite_received' };
    }

    if (envelope.message_type === 'SHIFT_ACCEPT') {
      const senderPub = envelope.sender_ephemeral_public_key ?? envelope.sender_encryption_public_key;
      const payload = decodeBoxPayload<ShiftAcceptPayload>(envelope, identity.encryption_private_key, senderPub);
      const shift = await getShift(db, payload.shift_id);
      if (!shift) throw new Error('Shift not found.');
      if (shift.protocol_state !== 'invite_sent') throw new Error('Shift not awaiting acceptance.');
      if (shift.invite_nonce !== payload.invite_nonce) throw new Error('Invite nonce mismatch.');
      await db.runAsync(
        `UPDATE caregiver_shifts
            SET status = 'confirmed', protocol_state = 'accepted_pending_session',
                alternate_device_id = ?, alternate_identity_key = ?, accepted_at = ?
          WHERE id = ?`,
        [payload.alternate_device_id, payload.alternate_public_key, payload.accepted_at, payload.shift_id],
      );
      await db.runAsync(
        `INSERT OR REPLACE INTO shift_peer_keys
           (shift_id, peer_role, peer_identity_key, peer_ephemeral_key, established_at)
         VALUES (?, 'alternate', ?, ?, ?)`,
        [payload.shift_id, payload.alternate_public_key, senderPub, now()],
      );
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'shift_accept_received' };
    }

    if (envelope.message_type === 'SHIFT_ACTIVATE') {
      const shift = await getShift(db, envelope.shift_id);
      if (!shift) throw new Error('Shift not found.');
      if (['completed', 'cancelled', 'expired', 'rejected'].includes(shift.protocol_state)) {
        throw new Error('Cannot activate an inactive shift.');
      }
      const senderPub = shift.primary_identity_key ?? envelope.sender_encryption_public_key;
      const payload = decodeBoxPayload<ShiftActivatePayload>(envelope, identity.encryption_private_key, senderPub);
      if (new Date(payload.activated_at).getTime() > new Date(shift.end_time).getTime()) {
        throw new Error('Cannot activate expired shift.');
      }
      await importDelegatedSnapshot(db, shift, payload);
      await db.runAsync(
        `UPDATE caregiver_shifts
            SET status = 'confirmed', protocol_state = 'active', session_id = ?, activated_at = ?, shift_version = ?
          WHERE id = ?`,
        [payload.session_id, payload.activated_at, payload.shift_version, payload.shift_id],
      );
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'shift_activated' };
    }

    if (envelope.message_type === 'DOSE_EVENT_BATCH') {
      const shift = await getShift(db, envelope.shift_id);
      if (!shift) throw new Error('Shift not found.');
      if (!shift.alternate_identity_key) throw new Error('Alternate identity key missing.');
      if (!['active', 'return_pending_import'].includes(shift.protocol_state)) {
        throw new Error('Shift no longer accepts dose events.');
      }
      const payload = decodeBoxPayload<DoseEventBatchPayload>(envelope, identity.encryption_private_key, shift.alternate_identity_key);
      for (const event of payload.events) {
        const dup = await db.getFirstAsync<{ protocol_event_id: string }>(
          'SELECT protocol_event_id FROM protocol_event_receipts WHERE protocol_event_id = ?',
          [event.event_id],
        );
        if (dup) continue;
        const med = await getMedicationAndEntity(db, event.medication_id);
        if (!med) throw new Error('Unknown medication for dose event.');
        if (!entityIdAllowed(shift.entity_ids, med.entity_id)) {
          throw new Error('Dose event outside delegated patient set.');
        }
        if (event.seq <= shift.last_applied_seq) throw new Error('Dose event sequence replayed.');
        await db.runAsync(
          `INSERT INTO dose_logs
             (id, medication_id, scheduled_at, taken_at, skipped, is_catchup, notes,
              protocol_event_id, protocol_shift_id, protocol_seq, protocol_sender_role,
              protocol_recorded_at, protocol_applied_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alternate', ?, ?, ?)`,
          [
            uuidv4(),
            event.medication_id,
            event.scheduled_at,
            event.taken_at,
            event.skipped ? 1 : 0,
            event.event_type === 'dose_catchup' ? 1 : 0,
            event.note,
            event.event_id,
            payload.shift_id,
            event.seq,
            event.recorded_at,
            now(),
            event.recorded_at,
          ],
        );
        await db.runAsync(
          `INSERT INTO protocol_event_receipts (protocol_event_id, shift_id, seq, received_at, applied_at, status)
           VALUES (?, ?, ?, ?, ?, 'accepted')`,
          [event.event_id, payload.shift_id, event.seq, now(), now()],
        );
        await db.runAsync(
          'UPDATE caregiver_shifts SET last_applied_seq = ? WHERE id = ?',
          [event.seq, payload.shift_id],
        );
        shift.last_applied_seq = event.seq;
      }
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'dose_events_imported' };
    }

    if (envelope.message_type === 'REFILL_EVENT_BATCH') {
      const shift = await getShift(db, envelope.shift_id);
      if (!shift) throw new Error('Shift not found.');
      if (!shift.alternate_identity_key) throw new Error('Alternate identity key missing.');
      if (!['active', 'return_pending_import'].includes(shift.protocol_state)) {
        throw new Error('Shift no longer accepts refill events.');
      }
      const payload = decodeBoxPayload<RefillEventBatchPayload>(envelope, identity.encryption_private_key, shift.alternate_identity_key);
      for (const event of payload.events) {
        const dup = await db.getFirstAsync<{ protocol_event_id: string }>(
          'SELECT protocol_event_id FROM protocol_event_receipts WHERE protocol_event_id = ?',
          [event.event_id],
        );
        if (dup) continue;
        const med = await getMedicationAndEntity(db, event.medication_id);
        if (!med) throw new Error('Unknown medication for refill event.');
        if (!entityIdAllowed(shift.entity_ids, med.entity_id)) {
          throw new Error('Refill event outside delegated patient set.');
        }
        if (event.seq <= shift.last_applied_seq) throw new Error('Refill event sequence replayed.');
        await db.runAsync(
          `INSERT INTO refill_events
             (id, protocol_event_id, shift_id, medication_id, seq, quantity, refill_date, days_supply, unit, recorded_at, applied_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), event.event_id, payload.shift_id, event.medication_id, event.seq, event.quantity, event.refill_date, event.days_supply, event.unit, event.recorded_at, now()],
        );
        await db.runAsync(
          `INSERT INTO prescriptions (id, medication_id, refill_date, quantity, days_supply, unit, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), event.medication_id, event.refill_date, event.quantity, event.days_supply, event.unit, event.recorded_at],
        );
        await db.runAsync(
          `INSERT INTO protocol_event_receipts (protocol_event_id, shift_id, seq, received_at, applied_at, status)
           VALUES (?, ?, ?, ?, ?, 'accepted')`,
          [event.event_id, payload.shift_id, event.seq, now(), now()],
        );
        await db.runAsync(
          'UPDATE caregiver_shifts SET last_applied_seq = ? WHERE id = ?',
          [event.seq, payload.shift_id],
        );
        shift.last_applied_seq = event.seq;
      }
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'refill_events_imported' };
    }

    if (envelope.message_type === 'SHIFT_RETURN_REQUEST') {
      const shift = await getShift(db, envelope.shift_id);
      if (!shift) throw new Error('Shift not found.');
      if (!shift.alternate_identity_key) throw new Error('Alternate identity key missing.');
      const payload = decodeBoxPayload<ShiftReturnRequestPayload>(envelope, identity.encryption_private_key, shift.alternate_identity_key);
      if (payload.final_seq !== shift.last_applied_seq) {
        throw new Error('Not all returned events have been imported.');
      }
      await db.runAsync(
        `UPDATE caregiver_shifts
            SET protocol_state = 'return_pending_import', return_requested_at = ?, final_seq = ?
          WHERE id = ?`,
        [payload.returned_at, payload.final_seq, payload.shift_id],
      );
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'shift_return_requested' };
    }

    if (envelope.message_type === 'SHIFT_RETURN_ACK') {
      const shift = await getShift(db, envelope.shift_id);
      if (!shift) throw new Error('Shift not found.');
      if (!shift.primary_identity_key) throw new Error('Primary identity key missing.');
      const payload = decodeBoxPayload<ShiftReturnAckPayload>(envelope, identity.encryption_private_key, shift.primary_identity_key);
      if (shift.protocol_state !== 'return_sent') throw new Error('Shift not awaiting return ack.');
      await deleteDelegatedSnapshot(db, payload.shift_id);
      await db.runAsync(
        `UPDATE caregiver_shifts
            SET status = 'completed', protocol_state = 'awaiting_cleanup_ack', return_acked_at = ?, cleanup_completed_at = ?
          WHERE id = ?`,
        [payload.acknowledged_at, now(), payload.shift_id],
      );
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'shift_return_acked_cleanup_done' };
    }

    if (envelope.message_type === 'SHIFT_COMPLETE_ACK') {
      const shift = await getShift(db, envelope.shift_id);
      if (!shift) throw new Error('Shift not found.');
      if (!shift.alternate_identity_key) throw new Error('Alternate identity key missing.');
      const payload = decodeBoxPayload<ShiftCompleteAckPayload>(envelope, identity.encryption_private_key, shift.alternate_identity_key);
      await db.runAsync(
        `UPDATE caregiver_shifts
            SET status = 'completed', protocol_state = 'completed', cleanup_completed_at = ?
          WHERE id = ?`,
        [payload.cleaned_up_at, payload.shift_id],
      );
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'shift_completed' };
    }

    if (envelope.message_type === 'SHIFT_CANCEL') {
      const shift = await getShift(db, envelope.shift_id);
      if (!shift) throw new Error('Shift not found.');
      const senderPub = shift.primary_identity_key ?? envelope.sender_encryption_public_key;
      const payload = decodeBoxPayload<ShiftCancelPayload>(envelope, identity.encryption_private_key, senderPub);
      await db.runAsync(
        `UPDATE caregiver_shifts
            SET status = 'cancelled', protocol_state = 'cancelled', cancel_reason = ?
          WHERE id = ?`,
        [payload.reason, payload.shift_id],
      );
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'shift_cancelled' };
    }

    if (envelope.message_type === 'SHIFT_REJECT') {
      const shift = await getShift(db, envelope.shift_id);
      if (!shift) throw new Error('Shift not found.');
      const senderPub = shift.alternate_identity_key ?? envelope.sender_encryption_public_key;
      const payload = decodeBoxPayload<ShiftRejectPayload>(envelope, identity.encryption_private_key, senderPub);
      await db.runAsync(
        `UPDATE caregiver_shifts
            SET status = 'cancelled', protocol_state = 'rejected', cancel_reason = ?
          WHERE id = ?`,
        [payload.reason, payload.shift_id],
      );
      await recordMessageReceipt(db, envelope, 'accepted');
      return { ok: true, action: 'shift_rejected' };
    }

    throw new Error(`Unsupported message type: ${envelope.message_type}`);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Protocol processing failed.' };
  }
}
