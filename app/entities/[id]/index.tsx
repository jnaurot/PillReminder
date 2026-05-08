import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEntity, deleteEntity } from '../../../src/db/entities';
import { getMedications, getDeletedMedications, deleteMedication, eraseAndDeleteMedication } from '../../../src/db/medications';
import { getSettings } from '../../../src/db/settings';
import { getRefillStatus, type RefillStatus } from '../../../src/db/prescriptions';
import { cancelForMedication } from '../../../src/notifications/scheduler';
import type { Entity, Medication, MedicationSchedule } from '../../../src/types';
import { parseSchedule } from '../../../src/types';

function ConfirmDeleteEntityModal({
  visible,
  entityName,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  entityName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => { if (!visible) setText(''); }, [visible]);
  const ready = text.trim().toLowerCase() === 'confirm';

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView
        style={cm.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={cm.card}>
          <Text style={cm.title}>Remove {entityName}?</Text>
          <Text style={cm.body}>
            This will permanently remove this person and all their medication history.{'\n\n'}
            Type <Text style={cm.bold}>confirm</Text> to proceed.
          </Text>
          <TextInput
            style={cm.input}
            value={text}
            onChangeText={setText}
            placeholder="type confirm"
            placeholderTextColor="#94A3B8"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={cm.buttons}>
            <TouchableOpacity style={cm.cancelBtn} onPress={onCancel}>
              <Text style={cm.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[cm.deleteBtn, !ready && cm.deleteBtnDisabled]}
              onPress={ready ? onConfirm : undefined}
              disabled={!ready}
            >
              <Text style={cm.deleteBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const cm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#FFF', borderRadius: 18, padding: 24, width: '100%', gap: 16 },
  title: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },
  body: { fontSize: 14, color: '#475569', lineHeight: 20 },
  bold: { fontWeight: '700', color: '#1A2F5A' },
  input: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: '#1A2F5A',
  },
  buttons: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: '#F1F5F9', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#475569' },
  deleteBtn: { flex: 1, backgroundColor: '#DC2626', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  deleteBtnDisabled: { backgroundColor: '#FCA5A5' },
  deleteBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
});

function formatScheduleSummary(scheduleJson: string): string {
  const schedule: MedicationSchedule = parseSchedule(scheduleJson);
  switch (schedule.type) {
    case 'fixed_times':
      return schedule.times.length > 0 ? schedule.times.join('  ·  ') : 'No times set';
    case 'prn': {
      const parts: string[] = ['As needed'];
      if (schedule.max_doses_per_day) parts.push(`max ${schedule.max_doses_per_day}/day`);
      if (schedule.min_interval_hours) parts.push(`≥${schedule.min_interval_hours}h apart`);
      return parts.join('  ·  ');
    }
    case 'weekly': {
      const days = ['Su','Mo','Tu','We','Th','Fr','Sa'];
      const dayStr = schedule.days.map((d) => days[d]).join(', ');
      return `Weekly: ${dayStr}`;
    }
    case 'monthly':
      return `Monthly: ${schedule.days.join(', ')}`;
  }
}

function RefillBadge({ status }: { status: RefillStatus }) {
  const { daysRemaining, unitsRemaining, isLow, prescription } = status;
  const unit = prescription.unit ?? 'pills';
  let label = '';
  if (daysRemaining !== null) {
    label = daysRemaining <= 0 ? 'Refill needed' : `${daysRemaining}d left`;
  } else if (unitsRemaining !== null) {
    label = unitsRemaining <= 0 ? 'Refill needed' : `~${unitsRemaining} ${unit} left`;
  }
  if (!label) return null;

  return (
    <View style={[styles.refillBadge, isLow && styles.refillBadgeLow]}>
      <Text style={[styles.refillBadgeText, isLow && styles.refillBadgeTextLow]}>{label}</Text>
    </View>
  );
}

function MedicationCard({
  medication,
  entityId,
  refillStatus,
  onDelete,
}: {
  medication: Medication;
  entityId: string;
  refillStatus: RefillStatus | null;
  onDelete: () => void;
}) {
  function confirmDelete() {
    Alert.alert(
      'Remove medication',
      `Remove "${medication.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          onPress: async () => {
            await deleteMedication(medication.id);
            await cancelForMedication(medication.id);
            onDelete();
          },
        },
        {
          text: 'Remove & Erase History',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Erase all history?',
              `This will permanently delete all dosing history and refill records for "${medication.name}". This cannot be undone.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Erase & Remove',
                  style: 'destructive',
                  onPress: async () => {
                    await cancelForMedication(medication.id);
                    await eraseAndDeleteMedication(medication.id);
                    onDelete();
                  },
                },
              ],
            );
          },
        },
      ]
    );
  }

  return (
    <View style={styles.medCard}>
      {/* Main tappable row → history screen */}
      <TouchableOpacity
        style={styles.medCardMain}
        onPress={() => router.push(`/entities/${entityId}/medications/${medication.id}`)}
        onLongPress={confirmDelete}
        activeOpacity={0.7}
      >
        <View style={[styles.medColorBar, { backgroundColor: medication.color }]} />
        <View style={styles.medBody}>
          <Text style={styles.medName}>{medication.name}</Text>
          <Text style={styles.medDosage}>
            {medication.dosage}  ·  {medication.pills_per_dose} pill{medication.pills_per_dose !== 1 ? 's' : ''} per dose
          </Text>
          <Text style={styles.medTimes}>{formatScheduleSummary(medication.schedule)}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {/* Footer row */}
      <View style={styles.medFooter}>
        <TouchableOpacity
          onPress={() => router.push(`/entities/${entityId}/medications/${medication.id}/history`)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.refillBtnText}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push(`/entities/${entityId}/medications/${medication.id}/refill`)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.refillBtnText}>+ Refill</Text>
        </TouchableOpacity>
        <View style={styles.medFooterRight}>
          {refillStatus && <RefillBadge status={refillStatus} />}
          <TouchableOpacity
            onPress={() => router.push(`/entities/${entityId}/medications/${medication.id}/edit`)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function EntityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [deletedMeds, setDeletedMeds] = useState<Medication[]>([]);
  const [showRemoved, setShowRemoved] = useState(false);
  const [refillMap, setRefillMap] = useState<Map<string, RefillStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const load = useCallback(async () => {
    const [e, meds, removed, settings] = await Promise.all([
      getEntity(id),
      getMedications(id),
      getDeletedMedications(id),
      getSettings(),
    ]);
    setEntity(e);
    setMedications(meds);
    setDeletedMeds(removed);

    const entries = await Promise.all(
      meds.map(async (m) => {
        const s = await getRefillStatus(m.id, settings.refill_alert_days);
        return [m.id, s] as [string, RefillStatus | null];
      })
    );
    const map = new Map<string, RefillStatus>();
    for (const [mid, s] of entries) {
      if (s) map.set(mid, s);
    }
    setRefillMap(map);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleDeleteEntity() {
    await deleteEntity(id);
    router.replace('/entities');
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#4A90D9" />
      </View>
    );
  }

  if (!entity) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Person not found.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}> ‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{entity.name}</Text>
        <TouchableOpacity onPress={() => router.push(`/entities/${id}/edit`)}>
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* Banners */}
      <TouchableOpacity
        style={styles.scheduleBanner}
        onPress={() => router.push(`/entities/${id}/schedule`)}
        activeOpacity={0.8}
      >
        <Text style={styles.scheduleBannerText}>📋  Today's Schedule</Text>
        <Text style={styles.scheduleBannerChevron}>›</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.complianceBanner}
        onPress={() => router.push(`/entities/${id}/compliance`)}
        activeOpacity={0.8}
      >
        <Text style={styles.complianceBannerText}>📊  Compliance Report</Text>
        <Text style={styles.scheduleBannerChevron}>›</Text>
      </TouchableOpacity>

      {/* Entity info card */}
      <View style={styles.infoCard}>
        <View style={styles.infoAvatar}>
          <Text style={styles.infoAvatarText}>
            {entity.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
          </Text>
        </View>
        <View style={styles.infoDetails}>
          <Text style={styles.infoName}>{entity.name}</Text>
          {entity.dob ? <Text style={styles.infoSub}>DOB: {entity.dob}</Text> : null}
          {entity.notes ? <Text style={styles.infoNotes} numberOfLines={2}>{entity.notes}</Text> : null}
        </View>
        <TouchableOpacity onPress={() => setShowDeleteModal(true)} style={styles.deleteBtn}>
          <Text style={styles.deleteText}>🗑</Text>
        </TouchableOpacity>
      </View>

      {/* Medications section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Medications</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push(`/entities/${id}/medications/new`)}
        >
          <Text style={styles.addButtonText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={medications}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MedicationCard
            medication={item}
            entityId={id}
            refillStatus={refillMap.get(item.id) ?? null}
            onDelete={load}
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>💊</Text>
            <Text style={styles.emptyTitle}>No medications yet</Text>
            <Text style={styles.emptySub}>Tap "+ Add" to add a medication</Text>
          </View>
        }
        ListFooterComponent={
          deletedMeds.length > 0 ? (
            <View style={styles.removedSection}>
              <TouchableOpacity
                style={styles.removedSectionHeader}
                onPress={() => setShowRemoved((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.removedSectionTitle}>
                  Removed medications ({deletedMeds.length})
                </Text>
                <Text style={styles.removedChevron}>{showRemoved ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {showRemoved && deletedMeds.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.removedCard}
                  onPress={() => router.push(`/entities/${id}/medications/${m.id}`)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.medColorBar, { backgroundColor: m.color }]} />
                  <View style={styles.removedBody}>
                    <Text style={styles.removedName}>{m.name}</Text>
                    <Text style={styles.removedSub}>
                      {m.dosage}  ·  removed {m.deleted_at!.slice(0, 10)}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null
        }
      />

      <ConfirmDeleteEntityModal
        visible={showDeleteModal}
        entityName={entity.name}
        onConfirm={handleDeleteEntity}
        onCancel={() => setShowDeleteModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  scheduleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A2F5A',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  complianceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#243B5E',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  scheduleBannerText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  complianceBannerText: { fontSize: 14, fontWeight: '500', color: '#CBD5E1' },
  scheduleBannerChevron: { fontSize: 22, color: '#4A90D9' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 10, marginRight: 4 },
  backText: { fontSize: 24, color: '#4A90D9', lineHeight: 28 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: '#1A2F5A' },
  editText: { fontSize: 16, color: '#4A90D9', fontWeight: '600' },
  infoCard: {
    margin: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  infoAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4A90D9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  infoAvatarText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  infoDetails: { flex: 1 },
  infoName: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },
  infoSub: { fontSize: 13, color: '#64748B', marginTop: 2 },
  infoNotes: { fontSize: 12, color: '#94A3B8', marginTop: 4 },
  deleteBtn: { padding: 8 },
  deleteText: { fontSize: 20 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1A2F5A' },
  addButton: {
    backgroundColor: '#4A90D9',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  addButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  list: { paddingHorizontal: 16, gap: 10 },
  medCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  medCardMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  medColorBar: { width: 5, alignSelf: 'stretch' },
  medBody: { flex: 1, padding: 14, gap: 3 },
  medName: { fontSize: 15, fontWeight: '600', color: '#1A2F5A' },
  medDosage: { fontSize: 13, color: '#64748B' },
  medTimes: { fontSize: 12, color: '#4A90D9', fontWeight: '500' },
  medFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  refillBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  refillBadgeLow: { backgroundColor: '#FEF2F2' },
  refillBadgeText: { fontSize: 11, fontWeight: '600', color: '#64748B' },
  refillBadgeTextLow: { color: '#DC2626' },
  refillBtnText: { fontSize: 12, color: '#4A90D9', fontWeight: '600' },
  medFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editBtnText: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  chevron: { fontSize: 22, color: '#CBD5E1', paddingRight: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 60 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#1A2F5A' },
  emptySub: { fontSize: 13, color: '#64748B' },

  removedSection: { marginTop: 20, marginBottom: 20 },
  removedSectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, paddingVertical: 8,
  },
  removedSectionTitle: { fontSize: 13, fontWeight: '600', color: '#94A3B8' },
  removedChevron: { fontSize: 12, color: '#94A3B8' },
  removedCard: {
    backgroundColor: '#FFF', borderRadius: 10, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center',
    opacity: 0.75, marginBottom: 6,
    borderWidth: 1, borderColor: '#F1F5F9',
  },
  removedBody: { flex: 1, padding: 12, gap: 2 },
  removedName: { fontSize: 14, fontWeight: '600', color: '#64748B' },
  removedSub: { fontSize: 12, color: '#94A3B8' },
});
