import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Contacts from 'expo-contacts';
import { getEntities } from '../../../src/db/entities';
import {
  getCaregivers, upsertCaregiver, createShift,
  buildInvitePayload, buildInviteSMS, type Caregiver,
} from '../../../src/db/caregivers';
import { getSettings } from '../../../src/db/settings';
import { defaultTransport } from '../../../src/messaging/transport';
import DateInput from '../../../src/components/DateInput';
import type { Entity } from '../../../src/types/index';
import { todayStr, nowTimeStr, tomorrowStr } from '../../../src/utils/dateTime';

export default function NewShiftScreen() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [savedCaregivers, setSavedCaregivers] = useState<Caregiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Caregiver fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);

  // Entity selection
  const [allEntities, setAllEntities] = useState(true);
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());

  // Time range
  const [startDate, setStartDate] = useState(todayStr());
  const [startTime, setStartTime] = useState(nowTimeStr());
  const [endDate, setEndDate] = useState(tomorrowStr());
  const [endTime, setEndTime] = useState('08:00');

  // Notes
  const [notes, setNotes] = useState('');

  const [primaryPhone, setPrimaryPhone] = useState('');

  useEffect(() => {
    Promise.all([getEntities(), getCaregivers(), getSettings()]).then(([ents, cgs, settings]) => {
      setEntities(ents);
      setSavedCaregivers(cgs);
      setPrimaryPhone(settings.primary_phone);
      setLoading(false);
    });
  }, []);

  async function pickContact() {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Contact access is required to pick a caregiver.');
      return;
    }
    try {
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;
      const pickedName = contact.name ?? '';
      const pickedPhone = contact.phoneNumbers?.[0]?.number?.replace(/\D/g, '') ?? '';
      setName(pickedName);
      setPhone(pickedPhone);
      setSelectedSavedId(null);
    } catch {
      Alert.alert('Could not open contacts.');
    }
  }

  function selectSaved(cg: Caregiver) {
    setSelectedSavedId(cg.id);
    setName(cg.name);
    setPhone(cg.phone);
  }

  function toggleEntity(id: string) {
    setSelectedEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAllEntities(false);
  }

  async function handleCreate() {
    if (!name.trim()) { Alert.alert('Caregiver name required.'); return; }
    if (!phone.trim()) { Alert.alert('Caregiver phone number required.'); return; }
    if (!/^\d{7,15}$/.test(phone.replace(/\D/g, ''))) {
      Alert.alert('Invalid phone number.');
      return;
    }

    const startISO = `${startDate}T${startTime}:00`;
    const endISO   = `${endDate}T${endTime}:00`;
    if (endISO <= startISO) {
      Alert.alert('End time must be after start time.');
      return;
    }

    setSaving(true);
    const resolvedPrimaryPhone = primaryPhone.replace(/\D/g, '');
    let shift: Awaited<ReturnType<typeof createShift>> | null = null;
    let cg: Awaited<ReturnType<typeof upsertCaregiver>> | null = null;
    try {
      cg = await upsertCaregiver(name.trim(), phone.replace(/\D/g, ''));
      const entityIds = allEntities ? [] : [...selectedEntityIds];
      shift = await createShift(cg.id, entityIds, startISO, endISO, notes.trim() || undefined);
    } catch (e: any) {
      Alert.alert('Failed to create shift', e?.message ?? 'Unknown error.');
      setSaving(false);
      return;
    }

    // Shift created — now attempt to send SMS (failure here is non-fatal).
    const delegatedEntities = allEntities
      ? entities
      : entities.filter((e) => selectedEntityIds.has(e.id));

    try {
      const isAvailable = await defaultTransport.isAvailable();
      if (isAvailable) {
        if (resolvedPrimaryPhone) {
          const invitePayload = await buildInvitePayload(shift!, resolvedPrimaryPhone, delegatedEntities);
          const entityNames = delegatedEntities.map((e) => e.name);
          await defaultTransport.send({
            phone: phone.replace(/\D/g, ''),
            humanText: buildInviteSMS(cg!, entityNames, shift!),
            msg: invitePayload,
          });
        } else {
          const entityNames = delegatedEntities.map((e) => e.name);
          await defaultTransport.send({
            phone: phone.replace(/\D/g, ''),
            humanText: buildInviteSMS(cg!, entityNames, shift!),
            msg: {
              v: 1,
              type: 'SHIFT_INVITE',
              shiftId: shift!.id,
              confirmationCode: shift!.confirmation_code,
              startTime: shift!.start_time,
              endTime: shift!.end_time,
              shiftNotes: shift!.notes,
              primaryPhone: '',
              entities: [],
              medications: [],
            },
          });
        }
      } else {
        // SMS unavailable — show code so user can share manually.
        Alert.alert(
          'Shift created — share this code',
          `SMS is not available on this device. Share the following with ${cg!.name} so they can confirm:\n\nCARE-${shift!.confirmation_code}`,
        );
      }
    } catch (e: any) {
      // Shift is saved — just the SMS failed. Show code so user can retry manually.
      Alert.alert(
        'SMS failed — shift saved',
        `The shift was created but the SMS could not be sent.\n\nShare this code with ${cg!.name} manually:\n\nCARE-${shift!.confirmation_code}`,
      );
    } finally {
      setSaving(false);
    }

    router.replace('/caregivers');
  }

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color="#4A90D9" /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}> ‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>New Shift</Text>
          <TouchableOpacity onPress={handleCreate} disabled={saving}>
            <Text style={[styles.createText, saving && styles.disabled]}>
              {saving ? 'Sending…' : 'Create'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

          {/* Caregiver */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Caregiver</Text>

            {savedCaregivers.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.chipRow}>
                  {savedCaregivers.map((cg) => (
                    <TouchableOpacity
                      key={cg.id}
                      style={[styles.chip, selectedSavedId === cg.id && styles.chipActive]}
                      onPress={() => selectSaved(cg)}
                    >
                      <Text style={[styles.chipText, selectedSavedId === cg.id && styles.chipTextActive]}>
                        {cg.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}

            <TouchableOpacity style={styles.contactBtn} onPress={pickContact}>
              <Text style={styles.contactBtnText}>📋  Pick from Contacts</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(t) => { setName(t); setSelectedSavedId(null); }}
              placeholder="Full name"
              placeholderTextColor="#CBD5E1"
            />
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={(t) => { setPhone(t); setSelectedSavedId(null); }}
              placeholder="Phone number"
              placeholderTextColor="#CBD5E1"
              keyboardType="phone-pad"
            />
          </View>

          {/* Entities */}
          {entities.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Responsibility For</Text>
              <View style={styles.entityRow}>
                <TouchableOpacity
                  style={[styles.entityChip, allEntities && styles.entityChipActive]}
                  onPress={() => setAllEntities(true)}
                >
                  <Text style={[styles.entityChipText, allEntities && styles.entityChipTextActive]}>All</Text>
                </TouchableOpacity>
                {entities.map((e) => {
                  const on = !allEntities && selectedEntityIds.has(e.id);
                  return (
                    <TouchableOpacity
                      key={e.id}
                      style={[styles.entityChip, on && styles.entityChipActive]}
                      onPress={() => toggleEntity(e.id)}
                    >
                      <Text style={[styles.entityChipText, on && styles.entityChipTextActive]}>{e.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Time range */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Shift Start</Text>
            <View style={styles.dateTimeRow}>
              <DateInput value={startDate} onChange={setStartDate} style={[styles.input, { flex: 1 }]} />
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={startTime}
                onChangeText={setStartTime}
                placeholder="HH:MM"
                placeholderTextColor="#CBD5E1"
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Shift End</Text>
            <View style={styles.dateTimeRow}>
              <DateInput value={endDate} onChange={setEndDate} style={[styles.input, { flex: 1 }]} />
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={endTime}
                onChangeText={setEndTime}
                placeholder="HH:MM"
                placeholderTextColor="#CBD5E1"
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. Evening routine, medication schedule attached"
              placeholderTextColor="#CBD5E1"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {!primaryPhone && (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                Your phone number isn't set. Without it, the caregiver's app can't send you dose
                updates. Add it in{' '}
                <Text style={styles.warnLink} onPress={() => router.push('/settings')}>
                  Settings → My Phone Number
                </Text>.
              </Text>
            </View>
          )}

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Tapping Create sends an SMS with a deep link. If the caregiver has PillReminder
              they can accept in-app; otherwise they reply with the confirmation code and you
              tap "Mark Confirmed".
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
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
  backText: { fontSize: 16, color: '#4A90D9' },
  title: { fontSize: 17, fontWeight: '600', color: '#1A2F5A' },
  createText: { fontSize: 16, color: '#4A90D9', fontWeight: '600' },
  disabled: { opacity: 0.4 },
  form: { padding: 20, gap: 20 },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: '#475569',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0',
  },
  chipActive: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  chipText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EEF6FF', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  contactBtnText: { fontSize: 14, color: '#2563EB', fontWeight: '600' },
  input: {
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#1A2F5A',
  },
  dateTimeRow: { flexDirection: 'row', gap: 10 },
  timeInput: { width: 90 },
  notesInput: { minHeight: 80 },
  entityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  entityChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0',
  },
  entityChipActive: { backgroundColor: '#1A2F5A', borderColor: '#1A2F5A' },
  entityChipText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  entityChipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  infoBox: {
    backgroundColor: '#F8FAFC', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 14,
  },
  infoText: { fontSize: 12, color: '#94A3B8', lineHeight: 18 },
  warnBox: {
    backgroundColor: '#FFFBEB', borderRadius: 10,
    borderWidth: 1, borderColor: '#FDE68A', padding: 14,
  },
  warnText: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  warnLink: { color: '#B45309', fontWeight: '600', textDecorationLine: 'underline' },
});
