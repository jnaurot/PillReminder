import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEntity } from '../../../src/db/entities';
import { getMedications } from '../../../src/db/medications';
import { getLogsForMedication } from '../../../src/db/doseLogs';
import { parseSchedule } from '../../../src/types';
import type { Entity, Medication } from '../../../src/types';
import { dateToStr as dateStr, nDaysAgo } from '../../../src/utils/dateTime';

function scheduledSlotsInPeriod(med: Medication, from: Date, to: Date): number {
  const schedule = parseSchedule(med.schedule);
  if (schedule.type === 'prn') return 0;

  let count = 0;
  const cur = new Date(from);
  while (cur <= to) {
    const dow = cur.getDay();
    const dom = cur.getDate();
    switch (schedule.type) {
      case 'fixed_times':
        count += schedule.times.length;
        break;
      case 'weekly':
        if (schedule.days.includes(dow)) count += schedule.times.length;
        break;
      case 'monthly':
        if (schedule.days.includes(dom)) count += schedule.times.length;
        break;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

interface MedStat {
  medication: Medication;
  isPrn: boolean;
  scheduled: number;
  taken: number;
  skipped: number;
  missed: number;
  pct: number | null;
}

const WINDOWS = [
  { label: '7 days', days: 6 },
  { label: '30 days', days: 29 },
  { label: '90 days', days: 89 },
];

export default function ComplianceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [stats, setStats] = useState<MedStat[]>([]);
  const [windowIdx, setWindowIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load(idx: number) {
    setLoading(true);
    const { days } = WINDOWS[idx];
    const from = nDaysAgo(days);
    const to = new Date();
    to.setHours(23, 59, 59, 999);

    const [ent, meds] = await Promise.all([getEntity(id), getMedications(id)]);
    setEntity(ent);

    const results: MedStat[] = await Promise.all(
      meds.map(async (med) => {
        const schedule = parseSchedule(med.schedule);
        const isPrn = schedule.type === 'prn';

        // Don't count days before the medication existed
        const createdDay = new Date(med.created_at);
        createdDay.setHours(0, 0, 0, 0);
        const effectiveFrom = createdDay > from ? createdDay : from;

        const logs = await getLogsForMedication(
          med.id,
          `${dateStr(effectiveFrom)}T00:00:00`,
          `${dateStr(to)}T23:59:59`,
        );
        const taken   = logs.filter((l) => !l.skipped).length;
        const skipped = logs.filter((l) => l.skipped).length;

        if (isPrn) {
          return { medication: med, isPrn: true, scheduled: 0, taken, skipped, missed: 0, pct: null };
        }

        const scheduled = scheduledSlotsInPeriod(med, effectiveFrom, to);
        const missed = Math.max(0, scheduled - taken - skipped);
        const pct = scheduled > 0 ? Math.round((taken / scheduled) * 100) : null;
        return { medication: med, isPrn: false, scheduled, taken, skipped, missed, pct };
      })
    );
    setStats(results);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { load(windowIdx); }, [id, windowIdx]));

  function selectWindow(idx: number) {
    setWindowIdx(idx);
  }

  const overallScheduled = stats.filter((s) => !s.isPrn).reduce((a, s) => a + s.scheduled, 0);
  const overallTaken     = stats.filter((s) => !s.isPrn).reduce((a, s) => a + s.taken, 0);
  const overallPct       = overallScheduled > 0 ? Math.round((overallTaken / overallScheduled) * 100) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}> ‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {entity?.name ?? ''} — Compliance
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Window selector */}
      <View style={styles.windowRow}>
        {WINDOWS.map((w, i) => (
          <TouchableOpacity
            key={w.label}
            style={[styles.windowChip, windowIdx === i && styles.windowChipActive]}
            onPress={() => selectWindow(i)}
          >
            <Text style={[styles.windowChipText, windowIdx === i && styles.windowChipTextActive]}>
              {w.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#4A90D9" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>

          {/* Overall summary */}
          {overallScheduled > 0 && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Overall adherence</Text>
              <Text style={[
                styles.summaryPct,
                overallPct !== null && overallPct >= 80 ? styles.pctGood :
                overallPct !== null && overallPct >= 60 ? styles.pctMid  : styles.pctLow,
              ]}>
                {overallPct !== null ? `${overallPct}%` : '—'}
              </Text>
              <Text style={styles.summaryMeta}>
                {overallTaken} of {overallScheduled} doses taken
              </Text>
              <BarFill pct={overallPct ?? 0} />
            </View>
          )}

          {/* Per-medication breakdown */}
          {stats.map((s) => (
            <View key={s.medication.id} style={styles.medCard}>
              <View style={[styles.medColorBar, { backgroundColor: s.medication.color }]} />
              <View style={styles.medBody}>
                <Text style={styles.medName}>{s.medication.name}</Text>
                <Text style={styles.medDosage}>{s.medication.dosage}</Text>

                {s.isPrn ? (
                  <Text style={styles.prnNote}>As-needed · {s.taken} dose{s.taken !== 1 ? 's' : ''} taken</Text>
                ) : (
                  <>
                    <View style={styles.statRow}>
                      <Stat label="Taken"   value={s.taken}   color="#16A34A" />
                      <Stat label="Skipped" value={s.skipped} color="#CA8A04" />
                      <Stat label="Missed"  value={s.missed}  color="#DC2626" />
                      <Stat label="Total"   value={s.scheduled} color="#64748B" />
                    </View>
                    {s.pct !== null && (
                      <>
                        <Text style={[
                          styles.medPct,
                          s.pct >= 80 ? styles.pctGood :
                          s.pct >= 60 ? styles.pctMid  : styles.pctLow,
                        ]}>
                          {s.pct}% adherence
                        </Text>
                        <BarFill pct={s.pct} />
                      </>
                    )}
                  </>
                )}
              </View>
            </View>
          ))}

          {stats.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>💊</Text>
              <Text style={styles.emptyTitle}>No medications</Text>
              <Text style={styles.emptySub}>Add medications to see compliance data.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={statS.box}>
      <Text style={[statS.value, { color }]}>{value}</Text>
      <Text style={statS.label}>{label}</Text>
    </View>
  );
}

function BarFill({ pct }: { pct: number }) {
  const clampedPct = Math.min(100, Math.max(0, pct));
  const color = clampedPct >= 80 ? '#16A34A' : clampedPct >= 60 ? '#CA8A04' : '#DC2626';
  return (
    <View style={bar.track}>
      <View style={[bar.fill, { width: `${clampedPct}%` as any, backgroundColor: color }]} />
    </View>
  );
}

const statS = StyleSheet.create({
  box:   { alignItems: 'center', flex: 1 },
  value: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
});

const bar = StyleSheet.create({
  track: { height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 3 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { width: 60, padding: 10 },
  backText: { fontSize: 16, color: '#4A90D9' },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1A2F5A', textAlign: 'center' },
  windowRow: {
    flexDirection: 'row', gap: 8, padding: 12,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  windowChip: {
    flex: 1, paddingVertical: 7, borderRadius: 20, alignItems: 'center',
    backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0',
  },
  windowChipActive: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  windowChipText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  windowChipTextActive: { color: '#FFFFFF' },
  list: { padding: 16, gap: 12, paddingBottom: 32 },
  summaryCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 20,
    alignItems: 'center', gap: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  summaryLabel: { fontSize: 12, fontWeight: '600', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryPct:   { fontSize: 48, fontWeight: '800', marginTop: 4 },
  summaryMeta:  { fontSize: 13, color: '#64748B', marginTop: 2 },
  pctGood: { color: '#16A34A' },
  pctMid:  { color: '#CA8A04' },
  pctLow:  { color: '#DC2626' },
  medCard: {
    backgroundColor: '#FFFFFF', borderRadius: 12, overflow: 'hidden',
    flexDirection: 'row',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  medColorBar: { width: 5, alignSelf: 'stretch' },
  medBody: { flex: 1, padding: 14, gap: 4 },
  medName:   { fontSize: 15, fontWeight: '600', color: '#1A2F5A' },
  medDosage: { fontSize: 12, color: '#64748B' },
  statRow:   { flexDirection: 'row', marginTop: 8 },
  medPct:    { fontSize: 13, fontWeight: '700', marginTop: 6 },
  prnNote:   { fontSize: 13, color: '#4A90D9', fontWeight: '500', marginTop: 4 },
  empty: { alignItems: 'center', marginTop: 60, gap: 10 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1A2F5A' },
  emptySub:   { fontSize: 14, color: '#64748B', textAlign: 'center' },
});
