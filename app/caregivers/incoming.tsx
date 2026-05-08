import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { decodeMessage } from '../../src/messaging/codec';
import { handleMessage } from '../../src/messaging/handlers';
import { defaultTransport } from '../../src/messaging/transport';
import { MSG_VERSION } from '../../src/messaging/types';
import type { AnyMessage, MsgShiftInvite, MsgShiftHandback } from '../../src/messaging/types';
import { getDb } from '../../src/db/database';

function fmtDT(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const RESULT_LABELS: Record<string, string> = {
  shift_confirmed:         'Caregiver confirmed — shift is active.',
  shift_declined:          'Caregiver declined — shift cancelled.',
  dose_updated:            'Dose log updated.',
  refill_updated:          'Refill recorded.',
  shift_handback_received: 'Shift ended — responsibility returned to you.',
  shift_completed:         'Shift data cleared from this device.',
};

type ScreenState = 'loading' | 'invite' | 'processing' | 'done' | 'error';

export default function IncomingScreen() {
  const { d } = useLocalSearchParams<{ d: string }>();
  const [msg, setMsg] = useState<AnyMessage | null>(null);
  const [state, setState] = useState<ScreenState>('loading');
  const [resultText, setResultText] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (!d) { finish(false, 'Missing message data.'); return; }
    const decoded = decodeMessage(d);
    if (!decoded) { finish(false, 'Could not decode message — it may be corrupted.'); return; }
    setMsg(decoded);
    if (decoded.type === 'SHIFT_INVITE') {
      setState('invite');
    } else {
      processMsg(decoded);
    }
  }, [d]);

  async function processMsg(m: AnyMessage) {
    setState('processing');
    const result = await handleMessage(m);
    if (!result.ok) {
      finish(false, (result as any).error);
      return;
    }
    // After a SHIFT_HANDBACK the primary should send SHIFT_COMPLETE back so
    // the caregiver's app knows to clean up (in case they haven't already).
    if (m.type === 'SHIFT_HANDBACK') {
      await handleHandbackAsPrimary(m);
      return;
    }
    finish(true, RESULT_LABELS[(result as any).action] ?? 'Done.');
  }

  async function handleHandbackAsPrimary(m: MsgShiftHandback) {
    // Look up the caregiver's phone from the shift record.
    let caregiverPhone = '';
    try {
      const row = await getDb().getFirstAsync<{ cg_phone: string }>(
        `SELECT c.phone AS cg_phone
         FROM caregiver_shifts s
         JOIN caregivers c ON s.caregiver_id = c.id
         WHERE s.id = ?`,
        [m.shiftId],
      );
      caregiverPhone = row?.cg_phone ?? '';
    } catch { /* DB not ready yet — proceed without phone */ }

    if (!caregiverPhone) {
      finish(true, RESULT_LABELS.shift_handback_received ?? 'Shift ended.');
      return;
    }

    // Offer to send SHIFT_COMPLETE so the caregiver's app cleans up.
    Alert.alert(
      'Shift ended',
      'The caregiver has handed back responsibility. Send them a confirmation so their app removes shared patients?',
      [
        {
          text: 'Skip',
          style: 'cancel',
          onPress: () => finish(true, 'Shift ended — responsibility returned to you.'),
        },
        {
          text: 'Send confirmation',
          onPress: async () => {
            try {
              await defaultTransport.send({
                phone: caregiverPhone,
                humanText: 'Your caregiver shift has been acknowledged. Thank you!',
                msg: { v: MSG_VERSION, type: 'SHIFT_COMPLETE', shiftId: m.shiftId },
              });
            } catch (e: any) {
              Alert.alert('SMS error', e?.message ?? 'Could not send.');
            }
            finish(true, 'Shift ended — caregiver notified.');
          },
        },
      ],
    );
  }

  function finish(ok: boolean, text: string) {
    setResultText(text);
    setState(ok ? 'done' : 'error');
  }

  async function handleAccept() {
    if (!msg || msg.type !== 'SHIFT_INVITE') return;
    setActing(true);

    const result = await handleMessage(msg);
    if (!result.ok) {
      Alert.alert('Error', (result as any).error);
      setActing(false);
      return;
    }

    try {
      await defaultTransport.send({
        phone: msg.primaryPhone,
        humanText: `Caregiver accepted. Shift starts ${fmtDT(msg.startTime)}.`,
        msg: {
          v: MSG_VERSION,
          type: 'SHIFT_ACCEPT',
          shiftId: msg.shiftId,
          confirmationCode: msg.confirmationCode,
        },
      });
    } catch (e: any) {
      Alert.alert(
        'SMS error',
        `Could not send acceptance SMS: ${e?.message ?? 'unknown'}. ` +
        'You may want to notify the primary caregiver manually.',
      );
    }

    router.replace('/today');
  }

  async function handleDecline() {
    if (!msg || msg.type !== 'SHIFT_INVITE') return;
    setActing(true);
    try {
      await defaultTransport.send({
        phone: msg.primaryPhone,
        humanText: 'Caregiver declined the shift.',
        msg: { v: MSG_VERSION, type: 'SHIFT_DECLINE', shiftId: msg.shiftId, reason: null },
      });
    } catch { /* non-fatal */ }
    router.replace('/today');
  }

  // ── Loading / processing ─────────────────────────────────────────────────

  if (state === 'loading' || state === 'processing') {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#4A90D9" size="large" />
        {state === 'processing' && <Text style={s.sub}>Processing…</Text>}
      </View>
    );
  }

  if (state === 'done') {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <View style={s.center}>
          <Text style={s.bigIcon}>✓</Text>
          <Text style={s.resultTitle}>Done</Text>
          <Text style={s.resultSub}>{resultText}</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.replace('/today')}>
            <Text style={s.primaryBtnText}>Go to Today</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <View style={s.center}>
          <Text style={[s.bigIcon, { color: '#DC2626' }]}>!</Text>
          <Text style={s.resultTitle}>Error</Text>
          <Text style={s.resultSub}>{resultText}</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.replace('/today')}>
            <Text style={s.primaryBtnText}>Go to Today</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── SHIFT_INVITE ─────────────────────────────────────────────────────────

  const invite = msg as MsgShiftInvite;
  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Caregiver Invite</Text>
        <Text style={s.headerSub}>You've been asked to cover a caregiver shift</Text>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <View style={s.card}>
          <Text style={s.cardLabel}>From</Text>
          <Text style={s.cardValue}>{invite.primaryPhone}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>Shift window</Text>
          <Text style={s.cardValue}>{fmtDT(invite.startTime)}</Text>
          <Text style={s.cardSub}>to {fmtDT(invite.endTime)}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>Patients ({invite.entities.length})</Text>
          {invite.entities.map((e) => (
            <Text key={e.id} style={s.cardValue}>{e.name}</Text>
          ))}
          <Text style={s.cardSub}>{invite.medications.length} medication(s) included</Text>
        </View>

        {invite.shiftNotes ? (
          <View style={s.card}>
            <Text style={s.cardLabel}>Notes</Text>
            <Text style={s.cardValue}>{invite.shiftNotes}</Text>
          </View>
        ) : null}

        <View style={s.infoBox}>
          <Text style={s.infoText}>
            Accepting will import the patients and their medications into your PillReminder app
            for the duration of this shift.
          </Text>
        </View>

        <View style={s.actions}>
          <TouchableOpacity
            style={[s.btn, s.declineBtn]}
            onPress={handleDecline}
            disabled={acting}
          >
            <Text style={[s.btnText, s.declineBtnText]}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btn} onPress={handleAccept} disabled={acting}>
            <Text style={s.btnText}>{acting ? 'Accepting…' : 'Accept'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  header: {
    backgroundColor: '#1A2F5A', paddingHorizontal: 20, paddingVertical: 20,
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  headerSub: { fontSize: 13, color: '#93C5FD', marginTop: 4, textAlign: 'center' },
  content: { padding: 20, gap: 12 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, gap: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardLabel: {
    fontSize: 11, fontWeight: '700', color: '#94A3B8',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  cardValue: { fontSize: 16, fontWeight: '600', color: '#1A2F5A' },
  cardSub: { fontSize: 13, color: '#64748B' },
  infoBox: {
    backgroundColor: '#EFF6FF', borderRadius: 10,
    borderWidth: 1, borderColor: '#BFDBFE', padding: 14,
  },
  infoText: { fontSize: 13, color: '#1D4ED8', lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  btn: {
    flex: 1, backgroundColor: '#4A90D9',
    paddingVertical: 15, borderRadius: 12, alignItems: 'center',
  },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  declineBtn: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  declineBtnText: { color: '#DC2626' },
  primaryBtn: {
    marginTop: 8, backgroundColor: '#4A90D9',
    paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 12, alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  bigIcon: { fontSize: 56, color: '#16A34A' },
  resultTitle: { fontSize: 22, fontWeight: '700', color: '#1A2F5A' },
  resultSub: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20 },
  sub: { fontSize: 14, color: '#94A3B8', marginTop: 10 },
});
