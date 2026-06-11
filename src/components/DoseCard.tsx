import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Modal,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import {
  getMissedDosesToday, logDoseTaken, logDoseSkipped,
  deleteLog, updateLogNote, todayStr,
  type ScheduledDose, type DoseStatus,
} from '../db/doseLogs';
import type { DoseLog } from '../types/index';
import { parseSchedule, parseInteractions } from '../types/index';
import type { MedicationInteraction } from '../types/index';
import {
  cancelDoseNotifications,
  rescheduleAll,
} from '../notifications/scheduler';
import { defaultTransport } from '../messaging/transport';
import {
  annotateDoseLogProtocolEvent,
  createDoseEventBatchEnvelope,
  getNextProtocolEventSeq,
  getShiftTransportContext,
} from '../messaging/secureProtocol';

export const STATUS_CONFIG: Record<DoseStatus, { label: string; bg: string; text: string }> = {
  locked:   { label: 'Scheduled', bg: '#F1F5F9', text: '#94A3B8' },
  upcoming: { label: 'Upcoming',  bg: '#F1F5F9', text: '#64748B' },
  due:      { label: 'Due now',   bg: '#FFF7ED', text: '#C2410C' },
  taken:    { label: 'Taken',     bg: '#F0FDF4', text: '#16A34A' },
  skipped:  { label: 'Skipped',  bg: '#FEF9C3', text: '#A16207' },
  missed:   { label: 'Missed',   bg: '#FEF2F2', text: '#DC2626' },
};

async function checkInteractions(
  dose: ScheduledDose,
  allDoses: ScheduledDose[],
): Promise<string | null> {
  const interactions: MedicationInteraction[] = parseInteractions(dose.medication.interactions);
  for (const ix of interactions) {
    if (ix.type === 'with') {
      const sibling = allDoses.find((d) => d.medication.id === ix.medication_id);
      if (sibling && sibling.status !== 'taken') {
        return `"${dose.medication.name}" should be taken together with "${ix.medication_name}", which hasn't been logged yet. Proceed anyway?`;
      }
    }
    if (ix.type === 'hours_after') {
      const sibling = allDoses.find((d) => d.medication.id === ix.medication_id);
      if (!sibling?.log?.taken_at) {
        return `"${dose.medication.name}" requires "${ix.medication_name}" to have been taken ${ix.hours}h earlier — not yet logged. Proceed anyway?`;
      }
      const elapsed = (Date.now() - new Date(sibling.log.taken_at).getTime()) / 3600000;
      if (elapsed < ix.hours) {
        return `"${dose.medication.name}" requires ${ix.hours}h after "${ix.medication_name}". ${(ix.hours - elapsed).toFixed(1)}h remaining. Proceed anyway?`;
      }
    }
  }
  return null;
}

// ─── PRN take modal ───────────────────────────────────────────────────────────

function PrnTakeModal({
  visible,
  onLog,
  onCancel,
}: {
  visible: boolean;
  onLog: (note: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  function handleLog() { onLog(text.trim()); setText(''); }

  return (
    <Modal visible={visible} animationType="slide" transparent onShow={() => setText('')}>
      <KeyboardAvoidingView
        style={nm.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={nm.sheet}>
          <Text style={nm.title}>Log as-needed dose</Text>
          <TextInput
            style={nm.input}
            value={text}
            onChangeText={setText}
            placeholder="Note (optional) — e.g. headache, pain level 6…"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            autoFocus
          />
          <View style={nm.actions}>
            <TouchableOpacity style={nm.cancelBtn} onPress={onCancel}>
              <Text style={nm.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={nm.saveBtn} onPress={handleLog}>
              <Text style={nm.saveText}>Log dose</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Note modal ───────────────────────────────────────────────────────────────

function NoteModal({
  visible,
  initialNote,
  onSave,
  onClose,
}: {
  visible: boolean;
  initialNote: string;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialNote);

  function handleSave() {
    onSave(text.trim());
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onShow={() => setText(initialNote)}>
      <KeyboardAvoidingView
        style={nm.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={nm.sheet}>
          <Text style={nm.title}>Dose note</Text>
          <TextInput
            style={nm.input}
            value={text}
            onChangeText={setText}
            placeholder="e.g. felt nauseous, took with extra water…"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoFocus
          />
          <View style={nm.actions}>
            <TouchableOpacity style={nm.cancelBtn} onPress={onClose}>
              <Text style={nm.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={nm.saveBtn} onPress={handleSave}>
              <Text style={nm.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const nm = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 36, gap: 16,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },
  input: {
    backgroundColor: '#F8FAFC', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#1A2F5A', minHeight: 100,
  },
  actions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center',
  },
  cancelText: { color: '#64748B', fontWeight: '600' },
  saveBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#4A90D9', alignItems: 'center',
  },
  saveText: { color: '#FFF', fontWeight: '600' },
});

// ─── Dose card ────────────────────────────────────────────────────────────────

export function DoseCard({
  dose,
  allDoses,
  onAction,
  isDelegated = false,
  isHighlighted = false,
}: {
  dose: ScheduledDose;
  allDoses: ScheduledDose[];
  onAction: () => void;
  isDelegated?: boolean;
  isHighlighted?: boolean;
}) {
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showPrnTakeModal, setShowPrnTakeModal] = useState(false);
  const [prnEditLog, setPrnEditLog] = useState<DoseLog | null>(null);

  const config  = STATUS_CONFIG[dose.status];
  const settled = dose.status === 'taken' || dose.status === 'skipped';
  const locked  = dose.status === 'locked';
  const food    = dose.medication.food_requirement;
  const isPrn   = parseSchedule(dose.medication.schedule).type === 'prn';
  const policy  = dose.effectiveMissedPolicy;
  const date    = todayStr();

  // ── Long-press on settled card ───────────────────────────────────────────────

  function handleLongPress() {
    if (!settled || !dose.log) return;
    const noteLabel = dose.log.notes ? 'Edit note' : 'Add note';
    Alert.alert(
      dose.status === 'taken' ? 'Dose taken' : 'Dose skipped',
      dose.medication.name,
      [
        {
          text: noteLabel,
          onPress: () => setShowNoteModal(true),
        },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: () => confirmUndo(),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  function confirmUndo() {
    const verb = dose.status === 'taken' ? 'un-log this dose' : 'un-skip this dose';
    Alert.alert(
      'Undo log entry',
      `This will remove the recorded ${dose.status === 'taken' ? 'take' : 'skip'} for ${dose.medication.name} at ${dose.timeLabel}. The dose will return to its scheduled state.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: async () => {
            if (dose.log) await deleteLog(dose.log.id);
            await rescheduleAll();
            onAction();
          },
        },
      ],
    );
  }

  async function handleNoteSave(note: string) {
    const target = prnEditLog ?? dose.log;
    if (target) {
      await updateLogNote(target.id, note || null);
      setPrnEditLog(null);
      onAction();
    }
  }

  // ── Take / Skip ──────────────────────────────────────────────────────────────

  async function handleTake() {
    const warning = await checkInteractions(dose, allDoses);
    if (isPrn) {
      if (warning) {
        Alert.alert('Interaction warning', warning, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Proceed', onPress: () => setShowPrnTakeModal(true) },
        ]);
        return;
      }
      setShowPrnTakeModal(true);
      return;
    }
    if (warning) {
      Alert.alert('Interaction warning', warning, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Proceed', onPress: () => executeTake() },
      ]);
      return;
    }
    executeTake();
  }

  async function executeTakePrn(note: string) {
    const logs = await logDoseTaken(dose.medication.id, null, undefined, note || undefined);
    await rescheduleAll();
    await maybeSendDoseEvents(logs.map((log) => ({
      log,
      eventType: 'dose_taken' as const,
      note: note || null,
    })));
  }

  async function maybeSendDoseEvents(
    entries: Array<{
      log: DoseLog;
      eventType: 'dose_taken' | 'dose_skipped' | 'dose_catchup';
      note: string | null;
    }>,
  ) {
    if (dose.shiftSource !== 'shared' || !dose.entityPrimaryPhone || !dose.sharedShiftId) {
      onAction();
      return;
    }
    Alert.alert(
      'Notify primary caregiver?',
      `Send ${entries.length > 1 ? 'dose updates' : 'a dose update'} for ${dose.medication.name} to the primary?`,
      [
        { text: 'Skip', style: 'cancel', onPress: onAction },
        {
          text: 'Send update',
          onPress: async () => {
            try {
              const context = await getShiftTransportContext(dose.sharedShiftId!);
              const startSeq = await getNextProtocolEventSeq(dose.sharedShiftId!);
              const events = entries.map((entry, index) => ({
                event_id: Crypto.randomUUID(),
                seq: startSeq + index,
                event_type: entry.eventType,
                patient_id: dose.medication.entity_id,
                medication_id: dose.medication.id,
                scheduled_at: entry.log.scheduled_at,
                recorded_at: entry.log.created_at,
                taken_at: entry.log.taken_at,
                skipped: entry.log.skipped === 1,
                note: entry.note,
              }));
              const envelope = await createDoseEventBatchEnvelope({
                shiftId: context.shiftId,
                transferId: context.transferId,
                sessionId: context.sessionId,
                events,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              });
              await defaultTransport.send({
                phone: dose.entityPrimaryPhone!,
                humanText: `Dose logged: ${dose.medication.name}${entries.some((entry) => entry.note) ? ' with notes' : ''}.`,
                msg: envelope,
              });
              for (const event of events) {
                await annotateDoseLogProtocolEvent({
                  medicationId: event.medication_id,
                  scheduledAt: event.scheduled_at,
                  eventId: event.event_id,
                  shiftId: context.shiftId,
                  seq: event.seq,
                  recordedAt: event.recorded_at,
                });
              }
            } catch (e: any) {
              Alert.alert('SMS error', e?.message ?? 'Could not send update.');
            }
            onAction();
          },
        },
      ],
    );
  }

  async function executeTake() {
    const missed = await getMissedDosesToday(
      dose.medication.id, date,
      dose.effectiveEarlyWindow, dose.effectiveMissedWindow,
    );

    if (missed.length === 0 || policy === 'none') {
              const logs = await logDoseTaken(dose.medication.id, dose.scheduledAt);
              if (dose.scheduledAt) {
                await cancelDoseNotifications(dose.medication.id, dose.scheduledAt);
              }
      await rescheduleAll();
      await maybeSendDoseEvents(logs.map((log) => ({
        log,
        eventType: 'dose_taken' as const,
        note: null,
      })));
      return;
    }

    const missedDose = missed[0];

    if (policy === 'catch_up') {
      Alert.alert(
        'Catch-up dose',
        `You have a missed dose at ${missedDose.timeLabel}.\n\nTaking now will log a catch-up entry for that missed dose AND your current dose — two entries total.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Take both',
            onPress: async () => {
              const logs = await logDoseTaken(
                dose.medication.id, dose.scheduledAt,
                missedDose.scheduledAt ?? undefined,
              );
              if (dose.scheduledAt) {
                await cancelDoseNotifications(dose.medication.id, dose.scheduledAt);
              }
              if (missedDose.scheduledAt) {
                await cancelDoseNotifications(dose.medication.id, missedDose.scheduledAt);
              }
              await rescheduleAll();
              await maybeSendDoseEvents(logs.map((log) => ({
                log,
                eventType: log.is_catchup ? 'dose_catchup' as const : 'dose_taken' as const,
                note: log.notes ?? null,
              })));
            },
          },
        ],
      );
      return;
    }

    if (policy === 'must_skip') {
      Alert.alert(
        'Missed dose must be skipped',
        `You have a missed dose at ${missedDose.timeLabel}. You must skip it before taking your current dose.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: `Skip ${missedDose.timeLabel} dose`,
            style: 'destructive',
            onPress: async () => {
              const skippedLogs = await logDoseSkipped(dose.medication.id, missedDose.scheduledAt!);
              const takenLogs = await logDoseTaken(dose.medication.id, dose.scheduledAt);
              if (dose.scheduledAt) {
                await cancelDoseNotifications(dose.medication.id, dose.scheduledAt);
              }
              if (missedDose.scheduledAt) {
                await cancelDoseNotifications(dose.medication.id, missedDose.scheduledAt);
              }
              await rescheduleAll();
              await maybeSendDoseEvents([
                ...skippedLogs.map((log) => ({
                  log,
                  eventType: 'dose_skipped' as const,
                  note: null,
                })),
                ...takenLogs.map((log) => ({
                  log,
                  eventType: 'dose_taken' as const,
                  note: null,
                })),
              ]);
            },
          },
        ],
      );
    }
  }

  async function handleSkip() {
    if (!dose.scheduledAt) return;
    Alert.alert(
      'Skip dose',
      `Skip ${dose.medication.name} at ${dose.timeLabel}?\n\nThis will be logged and no further reminder will follow for this dose.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: async () => {
            const logs = await logDoseSkipped(dose.medication.id, dose.scheduledAt!);
            await cancelDoseNotifications(dose.medication.id, dose.scheduledAt!);
            await rescheduleAll();
            await maybeSendDoseEvents(logs.map((log) => ({
              log,
              eventType: 'dose_skipped' as const,
              note: null,
            })));
          },
        },
      ],
    );
  }

  function openMedication() {
    router.push(`/entities/${dose.medication.entity_id}/medications/${dose.medication.id}` as any);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <TouchableOpacity
        style={[
          card.container,
          { borderLeftColor: dose.medication.color },
          locked && card.containerLocked,
          isDelegated && card.containerDelegated,
          isHighlighted && card.containerHighlighted,
        ]}
        onLongPress={settled ? handleLongPress : undefined}
        delayLongPress={400}
        activeOpacity={settled ? 0.7 : 1}
      >
        <View style={card.topRow}>
          <TouchableOpacity
            style={card.infoBlock}
            onPress={openMedication}
            activeOpacity={0.75}
          >
            <Text style={[card.medName, locked && card.textMuted]}>
              {dose.medication.name}
            </Text>
            <Text style={[card.dosage, locked && card.textMuted]}>
              {dose.medication.dosage}  ·  {dose.medication.pills_per_dose} per dose
            </Text>
            {food && !locked && (
              <Text style={card.food}>
                {food === 'with_food' ? '🍽 Take with food' : '🚫 Take without food'}
              </Text>
            )}
            {policy !== 'none' && !settled && !locked && (
              <Text style={card.policyBadge}>
                {policy === 'catch_up' ? '⚡ Catch-up if missed' : '⛔ Must skip if missed'}
              </Text>
            )}
          </TouchableOpacity>
          <View style={[card.badge, { backgroundColor: config.bg }]}>
            <Text style={[card.badgeText, { color: config.text }]}>{config.label}</Text>
          </View>
        </View>

        <Text style={[card.timeLabel, locked && card.textMuted]}>
          🕐 {dose.timeLabel}
          {locked && ` · available ${dose.effectiveEarlyWindow}min before`}
        </Text>

        {dose.log?.taken_at && (
          <Text style={card.takenAt}>
            {dose.log.is_catchup ? '⚡ Catch-up — ' : ''}Taken at{' '}
            {new Date(dose.log.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}

        {dose.log?.notes ? (
          <Text style={card.noteText}>📝 {dose.log.notes}</Text>
        ) : null}

        {settled && (
          <Text style={card.longPressHint}>Hold to add note or undo</Text>
        )}

        {isDelegated ? (
          <Text style={card.delegatedLabel}>🤝 Handled by caregiver</Text>
        ) : !settled && !locked ? (
          <View style={card.actions}>
            <TouchableOpacity style={card.takeBtn} onPress={handleTake}>
              <Text style={card.takeBtnText}>✓  Take</Text>
            </TouchableOpacity>
            {!isPrn && (
              <TouchableOpacity style={card.skipBtn} onPress={handleSkip}>
                <Text style={card.skipBtnText}>Skip</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {isPrn && dose.prnLogs && dose.prnLogs.length > 0 && (
          <View style={card.prnHistory}>
            <Text style={card.prnHistoryLabel}>Today's doses</Text>
            {dose.prnLogs.map((log) => {
              const timeStr = log.taken_at
                ? new Date(log.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '—';
              return (
                <TouchableOpacity
                  key={log.id}
                  style={card.prnEntry}
                  onLongPress={() => {
                    Alert.alert('As-needed dose', timeStr, [
                      {
                        text: log.notes ? 'Edit note' : 'Add note',
                        onPress: () => { setPrnEditLog(log); setShowNoteModal(true); },
                      },
                      {
                        text: 'Undo',
                        style: 'destructive',
                        onPress: async () => { await deleteLog(log.id); await rescheduleAll(); onAction(); },
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}
                  delayLongPress={400}
                  activeOpacity={0.75}
                >
                  <Text style={card.prnEntryTime}>{timeStr}</Text>
                  {log.notes ? <Text style={card.prnEntryNote}>📝 {log.notes}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </TouchableOpacity>

      <PrnTakeModal
        visible={showPrnTakeModal}
        onLog={(note) => { setShowPrnTakeModal(false); executeTakePrn(note); }}
        onCancel={() => setShowPrnTakeModal(false)}
      />

      <NoteModal
        visible={showNoteModal}
        initialNote={prnEditLog ? (prnEditLog.notes ?? '') : (dose.log?.notes ?? '')}
        onSave={handleNoteSave}
        onClose={() => { setShowNoteModal(false); setPrnEditLog(null); }}
      />
    </>
  );
}

export const card = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF', borderRadius: 14, borderLeftWidth: 5,
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, gap: 6,
  },
  containerHighlighted: {
    backgroundColor: '#FFF7ED',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },
  containerLocked: { backgroundColor: '#F8FAFC', opacity: 0.7 },
  containerDelegated: { opacity: 0.6, backgroundColor: '#F8FAFC' },
  delegatedLabel: { fontSize: 12, color: '#16A34A', fontWeight: '600', marginTop: 2 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start' },
  infoBlock: { flex: 1 },
  medName: { fontSize: 16, fontWeight: '700', color: '#1A2F5A' },
  dosage:  { fontSize: 13, color: '#64748B', marginTop: 2 },
  food:    { fontSize: 12, color: '#94A3B8', marginTop: 3 },
  policyBadge: { fontSize: 11, color: '#8E44AD', marginTop: 3, fontWeight: '600' },
  textMuted: { color: '#94A3B8' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginLeft: 8, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  timeLabel: { fontSize: 13, color: '#4A90D9', fontWeight: '500' },
  takenAt:  { fontSize: 12, color: '#16A34A' },
  noteText: { fontSize: 12, color: '#64748B', fontStyle: 'italic' },
  longPressHint: { fontSize: 11, color: '#CBD5E1', marginTop: 2 },
  actions:  { flexDirection: 'row', gap: 10, marginTop: 6 },
  takeBtn:  { flex: 1, backgroundColor: '#4A90D9', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  takeBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  skipBtn:  { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center' },
  skipBtnText: { color: '#64748B', fontWeight: '600', fontSize: 14 },
  prnHistory: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 8, gap: 6 },
  prnHistoryLabel: { fontSize: 11, fontWeight: '600', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.4 },
  prnEntry: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F8FAFC', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  prnEntryTime: { fontSize: 13, fontWeight: '600', color: '#1A2F5A', flex: 1 },
  prnEntryNote: { fontSize: 12, color: '#64748B', fontStyle: 'italic', flex: 2 },
});
