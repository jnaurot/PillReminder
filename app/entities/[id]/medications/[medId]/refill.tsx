import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMedication } from '../../../../../src/db/medications';
import { logRefill, getPrescriptions, deleteRefill, type Prescription } from '../../../../../src/db/prescriptions';
import { todayStr } from '../../../../../src/db/doseLogs';
import { getSettings } from '../../../../../src/db/settings';
import { getDb } from '../../../../../src/db/database';
import { defaultTransport } from '../../../../../src/messaging/transport';
import {
  createRefillEventBatchEnvelope,
  getNextProtocolEventSeq,
  getShiftTransportContext,
  recordOutgoingRefillProtocolEvent,
} from '../../../../../src/messaging/secureProtocol';
import {
  buildRefillHumanText,
  computeSuggestedDays,
  shouldOfferPrimaryRefillUpdate,
} from '../../../../../src/screens/criticalFlows';
import DateInput from '../../../../../src/components/DateInput';
import type { Medication } from '../../../../../src/types';
import { scheduleRefillAlert } from '../../../../../src/notifications/scheduler';

const UNITS = ['pills', 'capsules', 'mL', 'mg', 'patches', 'injections', 'puffs', 'drops', 'tablets'];

export default function RefillScreen() {
  const { id, medId } = useLocalSearchParams<{ id: string; medId: string }>();
  const [medication, setMedication] = useState<Medication | null>(null);
  const [history, setHistory] = useState<Prescription[]>([]);
  const [quantity, setQuantity] = useState('');
  const [daysSupply, setDaysSupply] = useState('');
  const [daysSupplyLocked, setDaysSupplyLocked] = useState(false);
  const [refillDate, setRefillDate] = useState(todayStr());
  const [unit, setUnit] = useState('pills');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const [med, rxs] = await Promise.all([getMedication(medId), getPrescriptions(medId)]);
    setMedication(med);
    setHistory(rxs);
  }

  useEffect(() => {
    reload().then(() => setLoading(false));
  }, [medId]);

  // Auto-update days supply when quantity changes (unless user has manually edited it)
  useEffect(() => {
    if (daysSupplyLocked || !medication) return;
    const suggested = computeSuggestedDays(medication, quantity);
    setDaysSupply(suggested !== null ? String(suggested) : '');
  }, [quantity, medication, daysSupplyLocked]);

  const suggestedDays = medication ? computeSuggestedDays(medication, quantity) : null;
  const showResetToAuto = daysSupplyLocked && suggestedDays !== null;
  const isInitialSupply = history.length === 0;

  async function handleSave() {
    Keyboard.dismiss();

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 1) {
      Alert.alert('Quantity required', 'Enter a valid quantity.');
      return;
    }
    const ds = daysSupply.trim() ? parseInt(daysSupply, 10) : null;
    if (daysSupply.trim() && (isNaN(ds!) || ds! < 1)) {
      Alert.alert('Invalid days supply', 'Enter a positive number or leave blank.');
      return;
    }
    if (refillDate.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(refillDate)) {
      Alert.alert('Invalid date', 'Enter the refill date as YYYY-MM-DD.');
      return;
    }

    setSaving(true);
    try {
      await logRefill(medId, qty, ds, refillDate || undefined, unit);
      if (ds && medication) {
        const settings = await getSettings();
        await scheduleRefillAlert(medId, medication.name, refillDate || todayStr(), ds, settings.refill_alert_days);
      }
      setQuantity('');
      setDaysSupply('');
      setDaysSupplyLocked(false);
      setRefillDate(todayStr());
      await reload();

      // If this medication belongs to a shared entity, offer to notify the primary.
      if (medication) {
        const entityRow = await getDb().getFirstAsync<{
          shift_source: string;
          shared_shift_id: string | null;
          primary_phone: string | null;
        }>('SELECT shift_source, shared_shift_id, primary_phone FROM entities WHERE id = ?', [medication.entity_id]);

        if (shouldOfferPrimaryRefillUpdate(entityRow)) {
          const primaryPhone = entityRow.primary_phone;
          const shiftId = entityRow.shared_shift_id;
          Alert.alert(
            'Notify primary caregiver?',
            `Send a refill update for ${medication.name} to the primary?`,
            [
              { text: 'Skip', style: 'cancel' },
              {
                text: 'Send update',
                onPress: async () => {
                  try {
                    const context = await getShiftTransportContext(shiftId);
                    const seq = await getNextProtocolEventSeq(shiftId);
                    const eventId = Crypto.randomUUID();
                    const recordedAt = new Date().toISOString();
                    const envelope = await createRefillEventBatchEnvelope({
                      shiftId: context.shiftId,
                      transferId: context.transferId,
                      sessionId: context.sessionId,
                      events: [{
                        event_id: eventId,
                        seq,
                        patient_id: medication.entity_id,
                        medication_id: medId,
                        refill_date: refillDate || todayStr(),
                        quantity: qty,
                        days_supply: ds ?? null,
                        unit,
                        recorded_at: recordedAt,
                      }],
                      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                    });
                    await defaultTransport.send({
                      phone: primaryPhone,
                      humanText: buildRefillHumanText(medication.name, qty, unit, ds ?? null),
                      msg: envelope,
                    });
                    await recordOutgoingRefillProtocolEvent({
                      eventId,
                      shiftId,
                      medicationId: medId,
                      seq,
                      quantity: qty,
                      refillDate: refillDate || todayStr(),
                      daysSupply: ds ?? null,
                      unit,
                      recordedAt,
                    });
                  } catch (e: any) {
                    Alert.alert('SMS error', e?.message ?? 'Could not send update.');
                  }
                },
              },
            ],
          );
        }
      }
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(rx: Prescription) {
    Alert.alert(
      'Remove refill entry',
      `Remove the ${rx.refill_date} refill of ${rx.quantity} ${rx.unit}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteRefill(rx.id);
            await reload();
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#4A90D9" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}> ‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {isInitialSupply ? 'Supply' : 'Refill'} — {medication?.name ?? ''}
          </Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            <Text style={[styles.saveText, saving && styles.saveDisabled]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.introCard}>
            <Text style={styles.introTitle}>{isInitialSupply ? 'Starting Supply' : 'Log Supply Change'}</Text>
            <Text style={styles.introText}>
              {isInitialSupply
                ? 'Record how much medication is currently on hand. Refill tracking stays unknown until supply is entered.'
                : 'Add the latest amount received. The app uses this supply history to estimate what remains.'}
            </Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Refill Date</Text>
            <DateInput value={refillDate} onChange={setRefillDate} style={styles.input} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Unit</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.chipRow}>
                {UNITS.map((u) => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.chip, unit === u && styles.chipActive]}
                    onPress={() => setUnit(u)}
                  >
                    <Text style={[styles.chipText, unit === u && styles.chipTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Quantity ({unit})</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
                placeholder="e.g. 90"
                placeholderTextColor="#CBD5E1"
                autoFocus
                returnKeyType="next"
              />
              <View style={styles.unitBadge}><Text style={styles.unitBadgeText}>{unit}</Text></View>
            </View>
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Days Supply</Text>
              {!daysSupplyLocked && daysSupply !== '' && (
                <View style={styles.autoChip}>
                  <Text style={styles.autoChipText}>auto</Text>
                </View>
              )}
            </View>
            <Text style={styles.hint}>
              {!daysSupplyLocked && daysSupply !== ''
                ? 'Calculated from schedule and quantity — edit to override.'
                : 'Optional — used to estimate when you\'ll run out.'}
            </Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={daysSupply}
                onChangeText={(t) => {
                  setDaysSupplyLocked(true);
                  setDaysSupply(t);
                }}
                keyboardType="numeric"
                placeholder={suggestedDays !== null ? `e.g. ${suggestedDays}` : 'e.g. 30'}
                placeholderTextColor="#CBD5E1"
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
              <View style={styles.unitBadge}><Text style={styles.unitBadgeText}>days</Text></View>
            </View>
            {showResetToAuto && (
              <TouchableOpacity
                onPress={() => setDaysSupplyLocked(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.autoReset}>↺ Use auto-calculated ({suggestedDays}d)</Text>
              </TouchableOpacity>
            )}
          </View>

          {history.length > 0 && (
            <View style={styles.historySection}>
              <Text style={styles.historyTitle}>Refill History</Text>
              <Text style={styles.hint}>Long-press an entry to remove it.</Text>
              {history.map((rx) => (
                <TouchableOpacity
                  key={rx.id}
                  style={styles.historyRow}
                  onLongPress={() => confirmDelete(rx)}
                  delayLongPress={400}
                  activeOpacity={0.7}
                >
                  <Text style={styles.historyDate}>{rx.refill_date}</Text>
                  <Text style={styles.historyDetail}>
                    {rx.quantity} {rx.unit}{rx.days_supply ? `  ·  ${rx.days_supply}d supply` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  introCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  introTitle: { fontSize: 15, fontWeight: '700', color: '#1A2F5A' },
  introText: { fontSize: 13, color: '#64748B', lineHeight: 19 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 10 },
  backText: { fontSize: 16, color: '#4A90D9' },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: '#1A2F5A', textAlign: 'center', marginHorizontal: 8 },
  saveText: { fontSize: 16, color: '#4A90D9', fontWeight: '600' },
  saveDisabled: { opacity: 0.4 },
  form: { padding: 20, gap: 20 },
  field: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  autoChip: {
    backgroundColor: '#DBEAFE', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  autoChipText: { fontSize: 10, fontWeight: '700', color: '#2563EB', textTransform: 'uppercase', letterSpacing: 0.5 },
  autoReset: { fontSize: 12, color: '#4A90D9', fontWeight: '500', marginTop: 2 },
  hint: { fontSize: 12, color: '#94A3B8' },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: {
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: '#1A2F5A',
  },
  unitBadge: {
    backgroundColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginLeft: 8,
  },
  unitBadgeText: { fontSize: 14, color: '#64748B', fontWeight: '600' },
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0',
  },
  chipActive: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  chipText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  historySection: { gap: 8, marginTop: 8 },
  historyTitle: { fontSize: 13, fontWeight: '600', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  historyRow: {
    backgroundColor: '#FFFFFF', borderRadius: 10, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  historyDate: { fontSize: 14, fontWeight: '600', color: '#1A2F5A' },
  historyDetail: { fontSize: 13, color: '#64748B' },
});
