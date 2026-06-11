let currentDb: FakeDb;

jest.mock('../src/db/database', () => ({
  getDb: jest.fn(() => currentDb),
}));

import * as ExpoCrypto from 'expo-crypto';
import {
  createDoseEventBatchEnvelope,
  createShiftAcceptEnvelope,
  createShiftActivateEnvelope,
  createShiftCompleteAckEnvelope,
  createShiftInviteEnvelope,
  createShiftReturnAckEnvelope,
  createShiftReturnRequestEnvelope,
  processProtocolEnvelope,
} from '../src/messaging/secureProtocol';
import type { ProtocolEnvelope } from '../src/messaging/protocol';

type Row = Record<string, any>;

class FakeDb {
  caregivers = new Map<string, Row>();
  caregiverShifts = new Map<string, Row>();
  entities = new Map<string, Row>();
  medications = new Map<string, Row>();
  doseLogs = new Map<string, Row>();
  deviceIdentity = new Map<string, Row>();
  shiftPeerKeys = new Map<string, Row>();
  protocolMessageReceipts = new Map<string, Row>();
  protocolEventReceipts = new Map<string, Row>();
  refillEvents = new Map<string, Row>();

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (sql.includes('FROM device_identity')) {
      return ([...this.deviceIdentity.values()][0] ?? null) as T | null;
    }
    if (sql.includes('FROM protocol_message_receipts WHERE nonce = ?')) {
      const nonce = params[0] as string;
      const row = [...this.protocolMessageReceipts.values()].find((r) => r.nonce === nonce);
      return (row ?? null) as T | null;
    }
    if (sql.includes('FROM caregiver_shifts WHERE id = ?')) {
      return (this.caregiverShifts.get(params[0] as string) ?? null) as T | null;
    }
    if (sql.includes('FROM medications WHERE id = ?')) {
      return (this.medications.get(params[0] as string) ?? null) as T | null;
    }
    if (sql.includes('FROM protocol_event_receipts WHERE protocol_event_id = ?')) {
      return (this.protocolEventReceipts.get(params[0] as string) ?? null) as T | null;
    }
    throw new Error(`Unhandled getFirstAsync SQL: ${sql}`);
  }

  async getAllAsync<T>(): Promise<T[]> {
    return [];
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('INSERT INTO device_identity')) {
      const [device_id, encryption_public_key, encryption_private_key, created_at] = params;
      this.deviceIdentity.set(device_id as string, { device_id, encryption_public_key, encryption_private_key, created_at });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET transfer_id = ?')) {
      const [transfer_id, shift_version, primary_device_id, primary_identity_key, invite_nonce, primary_phone, id] = params;
      const row = this.requireShift(id as string);
      Object.assign(row, {
        transfer_id,
        shift_version,
        primary_device_id,
        primary_identity_key,
        invite_nonce,
        primary_phone,
        protocol_state: 'invite_sent',
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET invite_nonce = ?')) {
      const [invite_nonce, id] = params;
      Object.assign(this.requireShift(id as string), { invite_nonce });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT OR REPLACE INTO shift_peer_keys')) {
      const [shift_id, peer_identity_key, peer_ephemeral_key, established_at] = params;
      this.shiftPeerKeys.set(shift_id as string, {
        shift_id,
        peer_identity_key,
        peer_ephemeral_key,
        established_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT OR REPLACE INTO caregivers')) {
      const [id, name, phone, created_at] = params;
      this.caregivers.set(id as string, { id, name, phone, created_at });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT OR REPLACE INTO caregiver_shifts')) {
      const [id, caregiver_id, start_time, end_time, transfer_id, shift_version, primary_device_id, primary_identity_key, invite_nonce, notes, primary_phone, created_at] = params;
      const existing = this.caregiverShifts.get(id as string) ?? {};
      this.caregiverShifts.set(id as string, {
        ...existing,
        id,
        caregiver_id,
        entity_ids: '[]',
        start_time,
        end_time,
        status: 'pending',
        protocol_state: 'invite_received',
        transfer_id,
        shift_version,
        primary_device_id,
        primary_identity_key,
        invite_nonce,
        confirmation_code: '',
        notes,
        primary_phone,
        created_at,
        last_applied_seq: 0,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET status = \'confirmed\', protocol_state = \'accepted_pending_session\'')) {
      const [alternate_device_id, alternate_identity_key, accepted_at, id] = params;
      Object.assign(this.requireShift(id as string), {
        status: 'confirmed',
        protocol_state: 'accepted_pending_session',
        alternate_device_id,
        alternate_identity_key,
        accepted_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET session_id = ?')) {
      const [session_id, activated_at, shift_version, id] = params;
      Object.assign(this.requireShift(id as string), {
        session_id,
        activated_at,
        shift_version,
        protocol_state: 'active',
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET status = \'confirmed\', protocol_state = \'active\'')) {
      const [session_id, activated_at, shift_version, id] = params;
      Object.assign(this.requireShift(id as string), {
        status: 'confirmed',
        session_id,
        activated_at,
        shift_version,
        protocol_state: 'active',
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT OR REPLACE INTO entities')) {
      const [
        id,
        name,
        dob,
        notes,
        shared_shift_id,
        primary_phone,
        delegation_owner_device_id,
        delegation_imported_at,
        delegation_expires_at,
        delegation_version,
        delegation_source_transfer_id,
        created_at,
        updated_at,
      ] = params;
      this.entities.set(id as string, {
        id,
        name,
        dob,
        notes,
        shift_source: 'shared',
        shared_shift_id,
        primary_phone,
        delegation_owner_device_id,
        delegation_imported_at,
        delegation_expires_at,
        delegation_cleanup_pending: 1,
        delegation_version,
        delegation_source_transfer_id,
        created_at,
        updated_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT OR REPLACE INTO medications')) {
      const [
        id,
        entity_id,
        name,
        dosage,
        pills_per_dose,
        schedule,
        food_requirement,
        interactions,
        missed_policy,
        early_window_minutes,
        missed_window_minutes,
        color,
        notes,
        shared_shift_id,
        delegation_imported_at,
        delegation_version,
        delegation_source_transfer_id,
        created_at,
        updated_at,
      ] = params;
      this.medications.set(id as string, {
        id,
        entity_id,
        name,
        dosage,
        pills_per_dose,
        schedule,
        food_requirement,
        interactions,
        missed_policy,
        early_window_minutes,
        missed_window_minutes,
        color,
        notes,
        shared_shift_id,
        delegation_imported_at,
        delegation_cleanup_pending: 1,
        delegation_version,
        delegation_source_transfer_id,
        created_at,
        updated_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO protocol_message_receipts') || norm.startsWith('INSERT OR REPLACE INTO protocol_message_receipts')) {
      const [id, shift_id, message_type, nonce, sender_identity_key, received_at, expires_at, signature_valid, status] = params;
      this.protocolMessageReceipts.set(id as string, {
        id, shift_id, message_type, nonce, sender_identity_key, received_at, expires_at, signature_valid, status,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO dose_logs')) {
      const [id, medication_id, scheduled_at, taken_at, skipped, is_catchup, notes, protocol_event_id, protocol_shift_id, protocol_seq, protocol_recorded_at, protocol_applied_at, created_at] = params;
      this.doseLogs.set(id as string, {
        id,
        medication_id,
        scheduled_at,
        taken_at,
        skipped,
        is_catchup,
        notes,
        protocol_event_id,
        protocol_shift_id,
        protocol_seq,
        protocol_sender_role: 'alternate',
        protocol_recorded_at,
        protocol_applied_at,
        created_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO protocol_event_receipts')) {
      const [protocol_event_id, shift_id, seq, received_at, applied_at] = params;
      this.protocolEventReceipts.set(protocol_event_id as string, {
        protocol_event_id, shift_id, seq, received_at, applied_at, status: 'accepted',
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET last_applied_seq = ?')) {
      const [last_applied_seq, id] = params;
      Object.assign(this.requireShift(id as string), { last_applied_seq });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO refill_events')) {
      const [id, protocol_event_id, shift_id, medication_id, seq, quantity, refill_date, unit, recorded_at, applied_at] = params;
      this.refillEvents.set(id as string, { id, protocol_event_id, shift_id, medication_id, seq, quantity, refill_date, unit, recorded_at, applied_at });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('INSERT INTO prescriptions')) {
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET protocol_state = \'return_sent\'')) {
      const [final_seq, return_requested_at, id] = params;
      Object.assign(this.requireShift(id as string), {
        protocol_state: 'return_sent',
        final_seq,
        return_requested_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET protocol_state = \'return_pending_import\'')) {
      const [time, maybeFinalOrId, maybeId] = params;
      const row = this.requireShift((maybeId ?? maybeFinalOrId) as string);
      Object.assign(row, {
        protocol_state: 'return_pending_import',
        return_requested_at: row.return_requested_at ?? time,
        return_acked_at: maybeId ? time : row.return_acked_at,
        final_seq: maybeId ? maybeFinalOrId : row.final_seq,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('DELETE FROM dose_logs WHERE medication_id IN')) {
      const shiftId = params[0] as string;
      const medIds = [...this.medications.values()].filter((m) => m.shared_shift_id === shiftId).map((m) => m.id);
      for (const [id, log] of this.doseLogs) {
        if (medIds.includes(log.medication_id)) this.doseLogs.delete(id);
      }
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('DELETE FROM prescriptions WHERE medication_id IN')) {
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('DELETE FROM refill_events WHERE shift_id = ?')) {
      const shiftId = params[0] as string;
      for (const [id, row] of this.refillEvents) {
        if (row.shift_id === shiftId) this.refillEvents.delete(id);
      }
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('DELETE FROM medications WHERE shared_shift_id = ?')) {
      const shiftId = params[0] as string;
      for (const [id, row] of this.medications) {
        if (row.shared_shift_id === shiftId) this.medications.delete(id);
      }
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('DELETE FROM entities WHERE shared_shift_id = ?')) {
      const shiftId = params[0] as string;
      for (const [id, row] of this.entities) {
        if (row.shared_shift_id === shiftId) this.entities.delete(id);
      }
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET status = \'completed\', protocol_state = \'awaiting_cleanup_ack\'')) {
      const [return_acked_at, cleanup_completed_at, id] = params;
      Object.assign(this.requireShift(id as string), {
        status: 'completed',
        protocol_state: 'awaiting_cleanup_ack',
        return_acked_at,
        cleanup_completed_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET status = \'completed\', protocol_state = \'completed\'')) {
      const [cleanup_completed_at, id] = params;
      Object.assign(this.requireShift(id as string), {
        status: 'completed',
        protocol_state: 'completed',
        cleanup_completed_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET status = \'cancelled\', protocol_state = \'cancelled\'')) {
      const [cancel_reason, id] = params;
      Object.assign(this.requireShift(id as string), { status: 'cancelled', protocol_state: 'cancelled', cancel_reason });
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (norm.startsWith('UPDATE caregiver_shifts SET status = \'cancelled\', protocol_state = \'rejected\'')) {
      const [cancel_reason, id] = params;
      Object.assign(this.requireShift(id as string), { status: 'cancelled', protocol_state: 'rejected', cancel_reason });
      return { changes: 1, lastInsertRowId: 0 };
    }

    throw new Error(`Unhandled runAsync SQL: ${sql}`);
  }

  private requireShift(id: string): Row {
    const row = this.caregiverShifts.get(id);
    if (!row) throw new Error(`Missing shift ${id}`);
    return row;
  }
}

describe('secure caregiver handoff protocol', () => {
  let idCounter = 0;

  function useDb(db: FakeDb) {
    currentDb = db;
  }

  beforeEach(() => {
    jest.setSystemTime(new Date('2026-06-03T12:00:00Z'));
    idCounter = 0;
    (ExpoCrypto.randomUUID as jest.Mock).mockImplementation(() => `uuid-${++idCounter}`);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('transfers without history, returns only events, and cleans up alternate data after ack', async () => {
    const primaryDb = new FakeDb();
    primaryDb.caregiverShifts.set('shift-1', {
      id: 'shift-1',
      caregiver_id: 'cg-1',
      entity_ids: JSON.stringify(['patient-1']),
      start_time: '2026-06-03T12:05:00Z',
      end_time: '2026-06-03T20:00:00Z',
      status: 'pending',
      protocol_state: 'draft',
      transfer_id: null,
      shift_version: 0,
      session_id: null,
      primary_phone: '15550001',
      primary_device_id: null,
      alternate_device_id: null,
      primary_identity_key: null,
      alternate_identity_key: null,
      invite_nonce: null,
      final_seq: null,
      last_applied_seq: 0,
      notes: 'Night shift',
    });
    primaryDb.entities.set('patient-1', {
      id: 'patient-1',
      name: 'Alice',
      dob: '1980-01-01',
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      deleted_at: null,
    });
    primaryDb.medications.set('med-1', {
      id: 'med-1',
      entity_id: 'patient-1',
      name: 'Aspirin',
      dosage: '1 tablet',
      pills_per_dose: 1,
      schedule: '{"type":"fixed_times","times":["08:00","20:00"]}',
      food_requirement: null,
      interactions: '[]',
      missed_policy: 'none',
      early_window_minutes: 30,
      missed_window_minutes: 60,
      color: '#4A90D9',
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      deleted_at: null,
    });
    primaryDb.doseLogs.set('log-history', {
      id: 'log-history',
      medication_id: 'med-1',
      scheduled_at: '2026-06-02T08:00:00Z',
      taken_at: '2026-06-02T08:10:00Z',
      skipped: 0,
      is_catchup: 0,
      notes: null,
      created_at: '2026-06-02T08:10:00Z',
    });

    useDb(primaryDb);
    const invite = await createShiftInviteEnvelope({
      shiftId: 'shift-1',
      transferId: 'transfer-1',
      primaryPhone: '15550001',
      startTime: '2026-06-03T12:05:00Z',
      endTime: '2026-06-03T20:00:00Z',
      shiftVersion: 1,
      shiftNote: 'Night shift',
      patientCount: 1,
      medicationCount: 1,
      expiresAt: '2026-06-03T13:00:00Z',
    });

    expect(invite.payload_encoding).toBe('plaintext');
    const inviteDecoded = JSON.parse(Buffer.from(invite.payload, 'base64').toString('utf8'));
    expect(inviteDecoded.patient_count).toBe(1);
    expect(inviteDecoded.medications).toBeUndefined();
    expect(inviteDecoded.patients).toBeUndefined();

    const alternateDb = new FakeDb();
    useDb(alternateDb);
    expect(await processProtocolEnvelope(invite)).toEqual({ ok: true, action: 'shift_invite_received' });
    expect(alternateDb.entities.size).toBe(0);
    expect(alternateDb.medications.size).toBe(0);

    const accept = await createShiftAcceptEnvelope(invite);
    expect(accept.payload_encoding).toBe('box');

    useDb(primaryDb);
    expect(await processProtocolEnvelope(accept)).toEqual({ ok: true, action: 'shift_accept_received' });
    expect(primaryDb.caregiverShifts.get('shift-1')?.protocol_state).toBe('accepted_pending_session');

    const activate = await createShiftActivateEnvelope({
      shiftId: 'shift-1',
      transferId: 'transfer-1',
      sessionId: 'session-1',
      shiftVersion: 1,
      patients: [
        { patient_id: 'patient-1', name: 'Alice', dob: '1980-01-01', notes: null },
      ],
      medications: [
        {
          medication_id: 'med-1',
          patient_id: 'patient-1',
          name: 'Aspirin',
          dosage: '1 tablet',
          pills_per_dose: 1,
          schedule: '{"type":"fixed_times","times":["08:00","20:00"]}',
          food_requirement: null,
          interactions: '[]',
          missed_policy: 'none',
          early_window_minutes: 30,
          missed_window_minutes: 60,
          color: '#4A90D9',
          notes: null,
        },
      ],
      expiresAt: '2026-06-03T13:00:00Z',
    });

    useDb(alternateDb);
    expect(await processProtocolEnvelope(activate)).toEqual({ ok: true, action: 'shift_activated' });
    expect(alternateDb.entities.get('patient-1')?.shared_shift_id).toBe('shift-1');
    expect(alternateDb.medications.get('med-1')?.shared_shift_id).toBe('shift-1');
    expect(alternateDb.doseLogs.size).toBe(0);

    alternateDb.doseLogs.set('alt-log-1', {
      id: 'alt-log-1',
      medication_id: 'med-1',
      scheduled_at: '2026-06-03T20:00:00Z',
      taken_at: '2026-06-03T20:03:00Z',
      skipped: 0,
      is_catchup: 0,
      notes: 'local alternate copy',
      created_at: '2026-06-03T20:03:00Z',
    });

    const doseBatch = await createDoseEventBatchEnvelope({
      shiftId: 'shift-1',
      transferId: 'transfer-1',
      sessionId: 'session-1',
      expiresAt: '2026-06-03T21:00:00Z',
      events: [
        {
          event_id: 'evt-1',
          seq: 1,
          event_type: 'dose_taken',
          patient_id: 'patient-1',
          medication_id: 'med-1',
          scheduled_at: '2026-06-03T20:00:00Z',
          recorded_at: '2026-06-03T20:03:00Z',
          taken_at: '2026-06-03T20:03:00Z',
          skipped: false,
          note: null,
        },
      ],
    });
    expect(doseBatch.payload_encoding).toBe('box');

    useDb(primaryDb);
    expect(await processProtocolEnvelope(doseBatch)).toEqual({ ok: true, action: 'dose_events_imported' });
    expect([...primaryDb.doseLogs.values()].some((row) => row.protocol_event_id === 'evt-1')).toBe(true);
    expect(primaryDb.caregiverShifts.get('shift-1')?.last_applied_seq).toBe(1);

    useDb(alternateDb);
    const returnRequest = await createShiftReturnRequestEnvelope({
      shiftId: 'shift-1',
      transferId: 'transfer-1',
      sessionId: 'session-1',
      finalSeq: 1,
      doseEventCount: 1,
      refillEventCount: 0,
      expiresAt: '2026-06-03T21:30:00Z',
    });

    useDb(primaryDb);
    expect(await processProtocolEnvelope(returnRequest)).toEqual({ ok: true, action: 'shift_return_requested' });
    expect(primaryDb.caregiverShifts.get('shift-1')?.protocol_state).toBe('return_pending_import');

    const returnAck = await createShiftReturnAckEnvelope({
      shiftId: 'shift-1',
      transferId: 'transfer-1',
      sessionId: 'session-1',
      finalSeq: 1,
      expiresAt: '2026-06-03T22:00:00Z',
    });

    useDb(alternateDb);
    expect(await processProtocolEnvelope(returnAck)).toEqual({ ok: true, action: 'shift_return_acked_cleanup_done' });
    expect(alternateDb.entities.size).toBe(0);
    expect(alternateDb.medications.size).toBe(0);
    expect(alternateDb.doseLogs.size).toBe(0);
    expect(alternateDb.caregiverShifts.get('shift-1')?.protocol_state).toBe('awaiting_cleanup_ack');

    const completeAck = await createShiftCompleteAckEnvelope({
      shiftId: 'shift-1',
      transferId: 'transfer-1',
      sessionId: 'session-1',
      expiresAt: '2026-06-03T22:15:00Z',
    });

    useDb(primaryDb);
    expect(await processProtocolEnvelope(completeAck)).toEqual({ ok: true, action: 'shift_completed' });
    expect(primaryDb.caregiverShifts.get('shift-1')?.protocol_state).toBe('completed');
  });

  it('rejects stale activation for a shift that is already over', async () => {
    const primaryDb = new FakeDb();
    primaryDb.caregiverShifts.set('shift-old', {
      id: 'shift-old',
      caregiver_id: 'cg-1',
      entity_ids: JSON.stringify(['patient-1']),
      start_time: '2026-06-03T08:00:00Z',
      end_time: '2026-06-03T09:00:00Z',
      status: 'pending',
      protocol_state: 'draft',
      transfer_id: null,
      shift_version: 0,
      session_id: null,
      primary_phone: '15550001',
      primary_device_id: null,
      alternate_device_id: null,
      primary_identity_key: null,
      alternate_identity_key: null,
      invite_nonce: null,
      final_seq: null,
      last_applied_seq: 0,
      notes: null,
    });

    useDb(primaryDb);
    const invite = await createShiftInviteEnvelope({
      shiftId: 'shift-old',
      transferId: 'transfer-old',
      primaryPhone: '15550001',
      startTime: '2026-06-03T08:00:00Z',
      endTime: '2026-06-03T09:00:00Z',
      shiftVersion: 1,
      shiftNote: null,
      patientCount: 1,
      medicationCount: 1,
      expiresAt: '2026-06-03T12:30:00Z',
    });

    const alternateDb = new FakeDb();
    useDb(alternateDb);
    await processProtocolEnvelope(invite);
    const accept = await createShiftAcceptEnvelope(invite);

    useDb(primaryDb);
    await processProtocolEnvelope(accept);
    const activate = await createShiftActivateEnvelope({
      shiftId: 'shift-old',
      transferId: 'transfer-old',
      sessionId: 'session-old',
      shiftVersion: 1,
      patients: [{ patient_id: 'patient-1', name: 'Alice', dob: null, notes: null }],
      medications: [],
      expiresAt: '2026-06-03T12:45:00Z',
    });

    useDb(alternateDb);
    const result = await processProtocolEnvelope(activate);
    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/inactive shift|expired/i);
    expect(alternateDb.entities.size).toBe(0);
  });

  it('rejects replayed event payloads and duplicate nonces', async () => {
    const primaryDb = new FakeDb();
    primaryDb.caregiverShifts.set('shift-dup', {
      id: 'shift-dup',
      caregiver_id: 'cg-1',
      entity_ids: JSON.stringify(['patient-1']),
      start_time: '2026-06-03T11:00:00Z',
      end_time: '2026-06-03T22:00:00Z',
      status: 'active',
      protocol_state: 'active',
      transfer_id: 'transfer-dup',
      shift_version: 1,
      session_id: 'session-dup',
      primary_phone: '15550001',
      primary_device_id: 'primary-device',
      alternate_device_id: 'alt-device',
      primary_identity_key: null,
      alternate_identity_key: null,
      invite_nonce: 'invite-nonce',
      final_seq: null,
      last_applied_seq: 0,
      notes: null,
    });
    primaryDb.medications.set('med-1', {
      id: 'med-1',
      entity_id: 'patient-1',
      name: 'Aspirin',
      dosage: '1 tablet',
      pills_per_dose: 1,
      schedule: '{}',
      food_requirement: null,
      interactions: '[]',
      missed_policy: 'none',
      early_window_minutes: 30,
      missed_window_minutes: 60,
      color: '#4A90D9',
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      deleted_at: null,
    });

    useDb(primaryDb);
    await createShiftInviteEnvelope({
      shiftId: 'shift-dup',
      transferId: 'transfer-dup',
      primaryPhone: '15550001',
      startTime: '2026-06-03T11:00:00Z',
      endTime: '2026-06-03T22:00:00Z',
      shiftVersion: 1,
      shiftNote: null,
      patientCount: 1,
      medicationCount: 1,
      expiresAt: '2026-06-03T13:00:00Z',
    });

    const altDb = new FakeDb();
    // Use the actual primary invite/accept exchange to establish keys.
    useDb(primaryDb);
    const realInvite = await createShiftInviteEnvelope({
      shiftId: 'shift-dup',
      transferId: 'transfer-dup',
      primaryPhone: '15550001',
      startTime: '2026-06-03T11:00:00Z',
      endTime: '2026-06-03T22:00:00Z',
      shiftVersion: 1,
      shiftNote: null,
      patientCount: 1,
      medicationCount: 1,
      expiresAt: '2026-06-03T13:00:00Z',
    });
    useDb(altDb);
    await processProtocolEnvelope(realInvite);
    const accept = await createShiftAcceptEnvelope(realInvite);
    useDb(primaryDb);
    await processProtocolEnvelope(accept);

    const activate = await createShiftActivateEnvelope({
      shiftId: 'shift-dup',
      transferId: 'transfer-dup',
      sessionId: 'session-dup',
      shiftVersion: 1,
      patients: [{ patient_id: 'patient-1', name: 'Alice', dob: null, notes: null }],
      medications: [],
      expiresAt: '2026-06-03T13:00:00Z',
    });
    useDb(altDb);
    await processProtocolEnvelope(activate);

    const batch = await createDoseEventBatchEnvelope({
      shiftId: 'shift-dup',
      transferId: 'transfer-dup',
      sessionId: 'session-dup',
      expiresAt: '2026-06-03T14:00:00Z',
      events: [{
        event_id: 'evt-dup',
        seq: 1,
        event_type: 'dose_taken',
        patient_id: 'patient-1',
        medication_id: 'med-1',
        scheduled_at: '2026-06-03T12:00:00Z',
        recorded_at: '2026-06-03T12:05:00Z',
        taken_at: '2026-06-03T12:05:00Z',
        skipped: false,
        note: null,
      }],
    });

    useDb(primaryDb);
    expect((await processProtocolEnvelope(batch)).ok).toBe(true);
    const replay = await processProtocolEnvelope(batch as ProtocolEnvelope);
    expect(replay.ok).toBe(false);
    expect((replay as any).error).toMatch(/duplicate protocol nonce/i);
  });
});
