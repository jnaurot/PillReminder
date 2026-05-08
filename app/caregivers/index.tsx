import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEntities } from '../../src/db/entities';
import {
  getLiveShifts, getRecentShifts, confirmShift, cancelShift, completeShift,
  buildInviteSMS, deleteSharedShiftData,
  type ShiftWithCaregiver,
} from '../../src/db/caregivers';
import { defaultTransport } from '../../src/messaging/transport';
import { MSG_VERSION } from '../../src/messaging/types';
import type { Entity } from '../../src/types/index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function entityLabel(shift: ShiftWithCaregiver, entities: Entity[]): string {
  try {
    const ids: string[] = JSON.parse(shift.entity_ids);
    if (ids.includes('*') || ids.length === 0) return 'All patients';
    return entities.filter((e) => ids.includes(e.id)).map((e) => e.name).join(', ') || 'All patients';
  } catch {
    return 'All patients';
  }
}

// ─── Status chip ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: '#FFF7ED', text: '#C2410C', label: 'Awaiting confirmation' },
  confirmed: { bg: '#EFF6FF', text: '#2563EB', label: 'Confirmed' },
  active:    { bg: '#F0FDF4', text: '#16A34A', label: 'Active now' },
  completed: { bg: '#F1F5F9', text: '#64748B', label: 'Completed' },
  cancelled: { bg: '#FEF2F2', text: '#DC2626', label: 'Cancelled' },
};

// ─── Shift card ───────────────────────────────────────────────────────────────

function ShiftCard({
  shift,
  entities,
  onRefresh,
}: {
  shift: ShiftWithCaregiver;
  entities: Entity[];
  onRefresh: () => void;
}) {
  const st = STATUS_STYLE[shift.resolvedStatus] ?? STATUS_STYLE.pending;
  const who = entityLabel(shift, entities);

  // When primary_phone is set, this device IS the caregiver (shift was imported via invite).
  const isCaregiver = shift.primary_phone !== '';

  // ── Primary-side actions ─────────────────────────────────────────────────

  function handleConfirm() {
    Alert.alert(
      'Confirm handoff',
      `Has ${shift.caregiver.name} replied with the code CARE-${shift.confirmation_code}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes, confirm', onPress: async () => { await confirmShift(shift.id); onRefresh(); } },
      ],
    );
  }

  function handleCancel() {
    Alert.alert('Cancel shift', 'Cancel this caregiver shift?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancel shift', style: 'destructive',
        onPress: async () => { await cancelShift(shift.id); onRefresh(); },
      },
    ]);
  }

  // Primary ends the shift → sends SHIFT_COMPLETE to caregiver (clean up their device)
  async function handlePrimaryComplete() {
    Alert.alert('End shift early', `End ${shift.caregiver.name}'s shift now?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'End shift',
        onPress: async () => {
          await completeShift(shift.id);
          try {
            await defaultTransport.send({
              phone: shift.caregiver.phone,
              humanText: `Your caregiver shift has ended. Thank you, ${shift.caregiver.name}!`,
              msg: { v: MSG_VERSION, type: 'SHIFT_COMPLETE', shiftId: shift.id },
            });
          } catch (e: any) {
            Alert.alert('SMS error', `Could not notify caregiver: ${e?.message ?? 'unknown'}.`);
          }
          onRefresh();
        },
      },
    ]);
  }

  async function handleResendInvite() {
    try {
      await defaultTransport.send({
        phone: shift.caregiver.phone,
        humanText: buildInviteSMS(shift.caregiver, [], shift),
        msg: { v: MSG_VERSION, type: 'SHIFT_INVITE', shiftId: shift.id,
          confirmationCode: shift.confirmation_code, startTime: shift.start_time,
          endTime: shift.end_time, shiftNotes: shift.notes, primaryPhone: '',
          entities: [], medications: [] },
      });
    } catch (e: any) {
      Alert.alert(
        'SMS failed — share manually',
        `Could not send SMS. Share this code with ${shift.caregiver.name}:\n\nCARE-${shift.confirmation_code}`,
      );
    }
  }

  // ── Caregiver-side actions ───────────────────────────────────────────────

  // Caregiver ends shift → cleans up shared entities locally, sends SHIFT_HANDBACK
  async function handleCaregiverEnd() {
    Alert.alert(
      'End your shift',
      'This will remove the shared patients from your app and notify the primary caregiver.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End shift',
          style: 'destructive',
          onPress: async () => {
            await deleteSharedShiftData(shift.id);
            await completeShift(shift.id);
            try {
              await defaultTransport.send({
                phone: shift.primary_phone,
                humanText: 'Caregiver shift ended. Responsibility returned to you.',
                msg: { v: MSG_VERSION, type: 'SHIFT_HANDBACK', shiftId: shift.id },
              });
            } catch (e: any) {
              Alert.alert('SMS error', `Shift ended locally but could not notify primary: ${e?.message ?? 'unknown'}.`);
            }
            onRefresh();
          },
        },
      ],
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={[card.container, shift.resolvedStatus === 'active' && card.activeContainer]}>
      {/* Top row */}
      <View style={card.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={card.name}>
            {isCaregiver ? `Primary: ${shift.caregiver.phone}` : shift.caregiver.name}
          </Text>
          <Text style={card.who}>
            {isCaregiver ? '🤝 You are the active caregiver' : who}
          </Text>
        </View>
        <View style={[card.statusChip, { backgroundColor: st.bg }]}>
          <Text style={[card.statusText, { color: st.text }]}>{st.label}</Text>
        </View>
      </View>

      {/* Time range */}
      <Text style={card.time}>
        {fmtDateTime(shift.start_time)}  →  {fmtDateTime(shift.end_time)}
      </Text>

      {/* Confirmation code — primary only */}
      {!isCaregiver && shift.resolvedStatus === 'pending' && (
        <View style={card.codeBox}>
          <Text style={card.codeLabel}>Waiting for reply</Text>
          <Text style={card.code}>CARE-{shift.confirmation_code}</Text>
        </View>
      )}

      {shift.notes ? <Text style={card.notes}>📝 {shift.notes}</Text> : null}

      {/* Actions — split by role */}
      {(shift.resolvedStatus === 'pending' || shift.resolvedStatus === 'confirmed' || shift.resolvedStatus === 'active') && (
        <View style={card.actions}>
          {isCaregiver ? (
            // Caregiver's device: only relevant action is ending the shift
            (shift.resolvedStatus === 'confirmed' || shift.resolvedStatus === 'active') && (
              <TouchableOpacity style={[card.actionBtn, card.endBtn]} onPress={handleCaregiverEnd}>
                <Text style={[card.actionBtnText, card.endBtnText]}>End my shift</Text>
              </TouchableOpacity>
            )
          ) : (
            // Primary's device
            <>
              {shift.resolvedStatus === 'pending' && (
                <>
                  <TouchableOpacity style={card.actionBtn} onPress={handleResendInvite}>
                    <Text style={card.actionBtnText}>Resend SMS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[card.actionBtn, card.confirmBtn]} onPress={handleConfirm}>
                    <Text style={[card.actionBtnText, card.confirmBtnText]}>Mark Confirmed</Text>
                  </TouchableOpacity>
                </>
              )}
              {shift.resolvedStatus === 'active' && (
                <TouchableOpacity style={[card.actionBtn, card.endBtn]} onPress={handlePrimaryComplete}>
                  <Text style={[card.actionBtnText, card.endBtnText]}>End shift</Text>
                </TouchableOpacity>
              )}
              {shift.resolvedStatus !== 'active' && (
                <TouchableOpacity style={[card.actionBtn, card.cancelBtn]} onPress={handleCancel}>
                  <Text style={[card.actionBtnText, card.cancelBtnText]}>Cancel</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const card = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  activeContainer: { borderWidth: 2, borderColor: '#16A34A' },
  topRow: { flexDirection: 'row', alignItems: 'flex-start' },
  name: { fontSize: 16, fontWeight: '700', color: '#1A2F5A' },
  who: { fontSize: 13, color: '#64748B', marginTop: 2 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, alignSelf: 'flex-start' },
  statusText: { fontSize: 11, fontWeight: '700' },
  time: { fontSize: 12, color: '#4A90D9', fontWeight: '500' },
  codeBox: {
    backgroundColor: '#FFF7ED', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#FED7AA',
  },
  codeLabel: { fontSize: 11, color: '#92400E', marginBottom: 2 },
  code: { fontSize: 18, fontWeight: '800', color: '#C2410C', letterSpacing: 2 },
  notes: { fontSize: 12, color: '#64748B', fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  actionBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0',
  },
  actionBtnText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  confirmBtn: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  confirmBtnText: { color: '#2563EB' },
  endBtn: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  endBtnText: { color: '#16A34A' },
  cancelBtn: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  cancelBtnText: { color: '#DC2626' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CaregiversScreen() {
  const [liveShifts, setLiveShifts] = useState<ShiftWithCaregiver[]>([]);
  const [pastShifts, setPastShifts] = useState<ShiftWithCaregiver[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [live, past, ents] = await Promise.all([
      getLiveShifts(),
      getRecentShifts(10),
      getEntities(),
    ]);
    setLiveShifts(live);
    setPastShifts(past);
    setEntities(ents);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color="#4A90D9" /></View>;
  }

  const activeShift = liveShifts.find((s) => s.resolvedStatus === 'active');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}> ‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Caregiver Shifts</Text>
        <TouchableOpacity onPress={() => router.push('/caregivers/shift/new')}>
          <Text style={styles.newText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {activeShift && (
        <View style={styles.activeBanner}>
          <Text style={styles.activeBannerTitle}>Active caregiver: {activeShift.caregiver.name}</Text>
          <Text style={styles.activeBannerSub}>Until {fmtDateTime(activeShift.end_time)}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.list}>
        {liveShifts.length === 0 && pastShifts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🤝</Text>
            <Text style={styles.emptyTitle}>No shifts yet</Text>
            <Text style={styles.emptySub}>
              Tap "+ New" to assign a caregiver for a specific time period.
            </Text>
          </View>
        ) : (
          <>
            {liveShifts.length > 0 && (
              <>
                <Text style={styles.groupLabel}>Active & Upcoming</Text>
                {liveShifts.map((s) => (
                  <ShiftCard key={s.id} shift={s} entities={entities} onRefresh={load} />
                ))}
              </>
            )}

            {pastShifts.length > 0 && (
              <>
                <Text style={[styles.groupLabel, { marginTop: 8 }]}>History</Text>
                {pastShifts.map((s) => (
                  <ShiftCard key={s.id} shift={s} entities={entities} onRefresh={load} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 10 },
  backText: { fontSize: 24, color: '#4A90D9', lineHeight: 28 },
  title: { fontSize: 17, fontWeight: '600', color: '#1A2F5A' },
  newText: { fontSize: 16, color: '#4A90D9', fontWeight: '600' },
  activeBanner: {
    backgroundColor: '#16A34A', paddingHorizontal: 20, paddingVertical: 12,
  },
  activeBannerTitle: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  activeBannerSub: { fontSize: 12, color: '#BBF7D0', marginTop: 2 },
  list: { padding: 16, gap: 12 },
  groupLabel: {
    fontSize: 13, fontWeight: '700', color: '#475569',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  empty: { alignItems: 'center', marginTop: 80, gap: 10 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1A2F5A' },
  emptySub: { fontSize: 14, color: '#64748B', textAlign: 'center', paddingHorizontal: 40 },
});
