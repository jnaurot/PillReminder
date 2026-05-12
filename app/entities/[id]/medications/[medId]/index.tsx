import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Image, FlatList, Modal, Linking,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMedication, updateMedicationRxInfo, deleteMedication, eraseAndDeleteMedication } from '../../../../../src/db/medications';
import { cancelForMedication } from '../../../../../src/notifications/scheduler';
import { fetchPillImages } from '../../../../../src/services/rxnorm';
import type { DrugInfo, Medication, PillAppearance, PillImage } from '../../../../../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDrugInfo(json: string | null): DrugInfo | null {
  if (!json) return null;
  try { return JSON.parse(json) as DrugInfo; } catch { return null; }
}

function parsePillAppearance(json: string | null): PillAppearance | null {
  if (!json) return null;
  try { return JSON.parse(json) as PillAppearance; } catch { return null; }
}

// ─── Drug info section ────────────────────────────────────────────────────────

function InfoRow({ label, text }: { label: string; text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const preview = text.length > 200 && !expanded;
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoText}>{preview ? text.slice(0, 200) + '…' : text}</Text>
      {text.length > 200 && (
        <TouchableOpacity onPress={() => setExpanded((v) => !v)}>
          <Text style={s.expandBtn}>{expanded ? 'Show less' : 'Read more'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Pill picker modal ────────────────────────────────────────────────────────

function PillPickerModal({
  visible,
  images,
  loading,
  onSelect,
  onClose,
}: {
  visible: boolean;
  images: PillImage[];
  loading: boolean;
  onSelect: (img: PillImage) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={pm.backdrop}>
        <View style={pm.sheet}>
          <View style={pm.header}>
            <Text style={pm.title}>Choose Pill Appearance</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={pm.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color="#4A90D9" style={{ marginVertical: 40 }} />
          ) : images.length === 0 ? (
            <View style={pm.empty}>
              <Text style={pm.emptyIcon}>🔍</Text>
              <Text style={pm.emptyText}>No pill images found in the NLM database.</Text>
              <Text style={pm.emptySub}>
                This can happen for generic medications or older formulations.
              </Text>
            </View>
          ) : (
            <FlatList
              data={images}
              keyExtractor={(item) => item.url}
              numColumns={2}
              contentContainerStyle={pm.grid}
              renderItem={({ item }) => (
                <TouchableOpacity style={pm.imgCard} onPress={() => onSelect(item)}>
                  <Image
                    source={{ uri: item.url }}
                    style={pm.img}
                    resizeMode="contain"
                  />
                  <Text style={pm.imgName} numberOfLines={2}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const pm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  title: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },
  close: { fontSize: 18, color: '#64748B', padding: 4 },
  grid: { padding: 12, gap: 12 },
  imgCard: { flex: 1, margin: 4, backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 8, alignItems: 'center' },
  img: { width: '100%', height: 120, borderRadius: 8 },
  imgName: { fontSize: 11, color: '#64748B', marginTop: 6, textAlign: 'center' },
  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyIcon: { fontSize: 36 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#1A2F5A', textAlign: 'center' },
  emptySub: { fontSize: 13, color: '#94A3B8', textAlign: 'center' },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MedicationDetailScreen() {
  const { id, medId } = useLocalSearchParams<{ id: string; medId: string }>();
  const [med, setMed] = useState<Medication | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerImages, setPickerImages] = useState<PillImage[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const load = useCallback(async () => {
    const m = await getMedication(medId);
    setMed(m);
    setLoading(false);
  }, [medId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function openPicker() {
    setShowPicker(true);
    if (!med?.rxcui) {
      setPickerImages([]);
      return;
    }
    setPickerLoading(true);
    const images = await fetchPillImages(med.rxcui);
    setPickerImages(images);
    setPickerLoading(false);
  }

  async function selectPillImage(img: PillImage) {
    if (!med) return;
    const appearance: PillAppearance = { type: 'image', url: img.url, name: img.name };
    await updateMedicationRxInfo(med.id, { pill_appearance: JSON.stringify(appearance) });
    setShowPicker(false);
    await load();
  }

  async function clearAppearance() {
    if (!med) return;
    Alert.alert('Clear pill appearance?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await updateMedicationRxInfo(med.id, { pill_appearance: null });
          await load();
        },
      },
    ]);
  }

  function handleDelete() {
    if (!med) return;
    Alert.alert(
      'Remove medication',
      `Remove "${med.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          onPress: async () => {
            await deleteMedication(med.id);
            await cancelForMedication(med.id);
            router.back();
          },
        },
        {
          text: 'Remove & Erase History',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Erase all history?',
              `This will permanently delete all dosing history and refill records for "${med.name}". This cannot be undone.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Erase & Remove',
                  style: 'destructive',
                  onPress: async () => {
                    await cancelForMedication(med.id);
                    await eraseAndDeleteMedication(med.id);
                    router.back();
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#4A90D9" />
      </View>
    );
  }

  if (!med) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Medication not found.</Text>
      </View>
    );
  }

  const drugInfo = parseDrugInfo(med.drug_info);
  const appearance = parsePillAppearance(med.pill_appearance);

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}> ‹ Back</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {!med.deleted_at && (
            <TouchableOpacity onPress={handleDelete} style={s.deleteBtn}>
              <Text style={s.deleteIcon}>🗑</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={!med.deleted_at ? () => router.push(`/entities/${id}/medications/${medId}/edit`) : undefined}
            disabled={!!med.deleted_at}
          >
            <Text style={[s.editBtn, med.deleted_at ? s.editBtnDisabled : null]}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Removed banner */}
      {med.deleted_at && (
        <View style={s.removedBanner}>
          <Text style={s.removedBannerText}>
            Removed on {med.deleted_at.slice(0, 10)} — history and drug info are preserved
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={s.body}>

        {/* Color + schedule summary */}
        <View style={[s.heroCard, { borderLeftColor: med.color }]}>
          <View style={[s.colorDot, { backgroundColor: med.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.heroName}>{med.name}</Text>
            <Text style={s.heroDosage}>{med.dosage}  ·  {med.pills_per_dose} pill{med.pills_per_dose !== 1 ? 's' : ''}/dose</Text>
            {med.notes ? <Text style={s.heroNotes}>{med.notes}</Text> : null}
          </View>
        </View>

        {/* Quick actions */}
        <View style={s.actionsRow}>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => router.push(`/entities/${id}/medications/${medId}/history`)}
          >
            <Text style={s.actionIcon}>📋</Text>
            <Text style={s.actionLabel}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, med.deleted_at ? s.actionBtnDisabled : null]}
            onPress={!med.deleted_at ? () => router.push(`/entities/${id}/medications/${medId}/refill`) : undefined}
            disabled={!!med.deleted_at}
          >
            <Text style={s.actionIcon}>💊</Text>
            <Text style={s.actionLabel}>Refill</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => router.push(`/entities/${id}/compliance`)}
          >
            <Text style={s.actionIcon}>📊</Text>
            <Text style={s.actionLabel}>Compliance</Text>
          </TouchableOpacity>
        </View>

        {/* Pill appearance */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Pill Appearance</Text>
          {appearance?.type === 'image' ? (
            <View style={s.pillImageCard}>
              <Image
                source={{ uri: appearance.url }}
                style={s.pillImage}
                resizeMode="contain"
              />
              <Text style={s.pillImageName}>{appearance.name}</Text>
              <View style={s.pillImageActions}>
                <TouchableOpacity style={s.pillChangeBtn} onPress={openPicker}>
                  <Text style={s.pillChangeBtnText}>Change</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.pillClearBtn} onPress={clearAppearance}>
                  <Text style={s.pillClearBtnText}>Clear</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={s.pillPickerBtn}
              onPress={openPicker}
              disabled={!med.rxcui}
            >
              <Text style={s.pillPickerIcon}>🔍</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.pillPickerBtnText}>
                  {med.rxcui ? 'Choose from database' : 'Not yet identified in RxNorm'}
                </Text>
                {!med.rxcui && (
                  <Text style={s.pillPickerSub}>Save the medication again to retry lookup</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Drug info */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Drug Information</Text>
          {!drugInfo ? (
            <View style={s.noInfo}>
              <Text style={s.noInfoText}>
                {med.rxcui
                  ? 'Drug information not available from MedlinePlus for this medication.'
                  : 'Drug information will appear here once the medication is identified in RxNorm.\nSave the medication again to retry.'}
              </Text>
            </View>
          ) : (
            <View style={s.infoCard}>
              <InfoRow label="Why prescribed"         text={drugInfo.why_prescribed} />
              <InfoRow label="How to take"            text={drugInfo.how_to_take} />
              <InfoRow label="Special precautions"    text={drugInfo.precautions} />
              <InfoRow label="Dietary instructions"   text={drugInfo.dietary_instructions} />
              <InfoRow label="If you miss a dose"     text={drugInfo.missed_dose} />
              <InfoRow label="Side effects"           text={drugInfo.side_effects} />
              <InfoRow label="Storage & disposal"     text={drugInfo.storage_disposal} />
              <TouchableOpacity
                onPress={() => Linking.openURL(drugInfo.source_url)}
                style={s.sourceRow}
              >
                <Text style={s.sourceLabel}>Source: </Text>
                <Text style={s.sourceLink}>{drugInfo.source_name}</Text>
                <Text style={s.sourceDate}>  ·  {drugInfo.fetched_at.slice(0, 10)}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

      </ScrollView>

      <PillPickerModal
        visible={showPicker}
        images={pickerImages}
        loading={pickerLoading}
        onSelect={selectPillImage}
        onClose={() => setShowPicker(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 10 },
  backText: { fontSize: 16, color: '#4A90D9' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },
  headerSub: { fontSize: 12, color: '#64748B' },
  editBtn: { fontSize: 15, color: '#4A90D9', fontWeight: '600' },
  editBtnDisabled: { color: '#CBD5E1' },
  deleteBtn: { padding: 4, marginRight: 12 },
  deleteIcon: { fontSize: 18 },
  removedBanner: { backgroundColor: '#FEF3C7', paddingHorizontal: 16, paddingVertical: 10 },
  removedBannerText: { fontSize: 13, color: '#92400E', fontWeight: '500' },
  actionBtnDisabled: { opacity: 0.4 },
  body: { padding: 16, gap: 16, paddingBottom: 40 },

  heroCard: {
    backgroundColor: '#FFF', borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderLeftWidth: 5,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  heroName: { fontSize: 18, fontWeight: '700', color: '#1A2F5A' },
  heroDosage: { fontSize: 13, color: '#64748B', marginTop: 2 },
  heroNotes: { fontSize: 12, color: '#94A3B8', marginTop: 4, fontStyle: 'italic' },

  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 12, padding: 14,
    alignItems: 'center', gap: 6,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  actionIcon: { fontSize: 22 },
  actionLabel: { fontSize: 12, fontWeight: '600', color: '#64748B' },

  section: { gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },

  pillImageCard: {
    backgroundColor: '#FFF', borderRadius: 14, padding: 16, alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  pillImage: { width: '100%', height: 160, borderRadius: 10 },
  pillImageName: { fontSize: 13, color: '#64748B', textAlign: 'center' },
  pillImageActions: { flexDirection: 'row', gap: 10 },
  pillChangeBtn: { backgroundColor: '#EEF6FF', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  pillChangeBtnText: { color: '#4A90D9', fontWeight: '600', fontSize: 14 },
  pillClearBtn: { backgroundColor: '#FEF2F2', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  pillClearBtnText: { color: '#DC2626', fontWeight: '600', fontSize: 14 },

  pillPickerBtn: {
    backgroundColor: '#FFF', borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: '#E2E8F0', borderStyle: 'dashed',
  },
  pillPickerIcon: { fontSize: 24 },
  pillPickerBtnText: { fontSize: 15, fontWeight: '600', color: '#4A90D9' },
  pillPickerSub: { fontSize: 12, color: '#94A3B8', marginTop: 2 },

  noInfo: { backgroundColor: '#FFF', borderRadius: 12, padding: 16 },
  noInfoText: { fontSize: 13, color: '#94A3B8', fontStyle: 'italic', lineHeight: 20 },

  infoCard: { backgroundColor: '#FFF', borderRadius: 14, padding: 16, gap: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  infoRow: { gap: 4 },
  infoLabel: { fontSize: 11, fontWeight: '700', color: '#4A90D9', textTransform: 'uppercase', letterSpacing: 0.4 },
  infoText: { fontSize: 14, color: '#334155', lineHeight: 20 },
  expandBtn: { fontSize: 13, color: '#4A90D9', fontWeight: '600', marginTop: 4 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, flexWrap: 'wrap' },
  sourceLabel: { fontSize: 11, color: '#94A3B8' },
  sourceLink: { fontSize: 11, color: '#4A90D9', textDecorationLine: 'underline' },
  sourceDate: { fontSize: 11, color: '#CBD5E1' },
});
