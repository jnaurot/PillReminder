import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Share,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEntity } from '../../../src/db/entities';
import { getEntityCompliance, type MedicationCompliance, type DayRecord } from '../../../src/db/compliance';
import type { Entity } from '../../../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adherenceColor(pct: number | null): string {
  if (pct === null) return '#94A3B8';
  if (pct >= 90) return '#16A34A';
  if (pct >= 70) return '#D97706';
  return '#DC2626';
}

function adherenceBg(pct: number | null): string {
  if (pct === null) return '#F1F5F9';
  if (pct >= 90) return '#F0FDF4';
  if (pct >= 70) return '#FFFBEB';
  return '#FEF2F2';
}

function offsetLabel(minutes: number | null): string {
  if (minutes === null) return '—';
  if (Math.abs(minutes) < 5) return 'On time';
  if (minutes < 0) return `${Math.abs(minutes)} min early`;
  return `${minutes} min late`;
}

function offsetColor(minutes: number | null): string {
  if (minutes === null) return '#94A3B8';
  if (Math.abs(minutes) < 5) return '#16A34A';
  if (Math.abs(minutes) < 30) return '#D97706';
  return '#DC2626';
}

// ─── 14-day dot grid ──────────────────────────────────────────────────────────

function DotGrid({ days }: { days: DayRecord[] }) {
  const last14 = days.slice(-14);
  return (
    <View style={dot.row}>
      {last14.map((d) => {
        let bg = '#E2E8F0'; // no doses
        if (d.scheduled > 0) {
          if (d.missed > 0) bg = '#FCA5A5';
          else if (d.skipped > 0) bg = '#FDE68A';
          else if (d.taken === d.scheduled) bg = '#86EFAC';
          else bg = '#E2E8F0'; // partially done (doses not yet due today)
        }
        const dayNum = new Date(d.date + 'T00:00:00').getDate();
        return (
          <View key={d.date} style={dot.cell}>
            <View style={[dot.circle, { backgroundColor: bg }]} />
            <Text style={dot.label}>{dayNum}</Text>
          </View>
        );
      })}
    </View>
  );
}

const dot = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  cell: { alignItems: 'center', width: 20 },
  circle: { width: 16, height: 16, borderRadius: 8 },
  label: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
});

// ─── Medication compliance card ───────────────────────────────────────────────

function ComplianceCard({ item }: { item: MedicationCompliance }) {
  const { medication: med, adherence7, adherence30, adherence90, avgOffsetMinutes, streak, days } = item;

  return (
    <View style={card.container}>
      <View style={[card.colorBar, { backgroundColor: med.color }]} />
      <View style={card.body}>
        <Text style={card.medName}>{med.name}</Text>
        <Text style={card.dosage}>{med.dosage}</Text>

        {/* Adherence rates */}
        <View style={card.rateRow}>
          {([
            { label: '7d', val: adherence7 },
            { label: '30d', val: adherence30 },
            { label: '90d', val: adherence90 },
          ] as const).map(({ label, val }) => (
            <View
              key={label}
              style={[card.ratePill, { backgroundColor: adherenceBg(val) }]}
            >
              <Text style={[card.rateLabel, { color: adherenceColor(val) }]}>
                {val !== null ? `${val}%` : '—'}
              </Text>
              <Text style={[card.ratePeriod, { color: adherenceColor(val) }]}>{label}</Text>
            </View>
          ))}

          {streak > 0 && (
            <View style={card.streakBadge}>
              <Text style={card.streakText}>🔥 {streak}d streak</Text>
            </View>
          )}
        </View>

        {/* Timing */}
        <View style={card.timingRow}>
          <Text style={card.timingLabel}>Avg timing: </Text>
          <Text style={[card.timingValue, { color: offsetColor(avgOffsetMinutes) }]}>
            {offsetLabel(avgOffsetMinutes)}
          </Text>
        </View>

        {/* 14-day dot grid */}
        <Text style={card.gridLabel}>Last 14 days</Text>
        <DotGrid days={days} />

        {/* Legend */}
        <View style={card.legend}>
          {[
            { color: '#86EFAC', label: 'Taken' },
            { color: '#FDE68A', label: 'Skipped' },
            { color: '#FCA5A5', label: 'Missed' },
            { color: '#E2E8F0', label: 'None' },
          ].map(({ color, label }) => (
            <View key={label} style={card.legendItem}>
              <View style={[card.legendDot, { backgroundColor: color }]} />
              <Text style={card.legendText}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const card = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  colorBar: { width: 5 },
  body: { flex: 1, padding: 14, gap: 6 },
  medName: { fontSize: 15, fontWeight: '700', color: '#1A2F5A' },
  dosage: { fontSize: 12, color: '#64748B' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  ratePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 52,
  },
  rateLabel: { fontSize: 15, fontWeight: '700' },
  ratePeriod: { fontSize: 10, fontWeight: '500', marginTop: 1 },
  streakBadge: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  streakText: { fontSize: 12, fontWeight: '600', color: '#C2410C' },
  timingRow: { flexDirection: 'row', alignItems: 'center' },
  timingLabel: { fontSize: 12, color: '#64748B' },
  timingValue: { fontSize: 12, fontWeight: '600' },
  gridLabel: { fontSize: 11, color: '#94A3B8', marginTop: 4, fontWeight: '500' },
  legend: { flexDirection: 'row', gap: 10, marginTop: 6, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 10, color: '#94A3B8' },
});

// ─── Summary stats bar ────────────────────────────────────────────────────────

function SummaryBar({ items }: { items: MedicationCompliance[] }) {
  if (items.length === 0) return null;

  const rates = items.map((i) => i.adherence30).filter((r): r is number => r !== null);
  const overall = rates.length > 0
    ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
    : null;
  const maxStreak = Math.max(...items.map((i) => i.streak), 0);

  return (
    <View style={summary.container}>
      <View style={summary.item}>
        <Text style={[summary.value, { color: adherenceColor(overall) }]}>
          {overall !== null ? `${overall}%` : '—'}
        </Text>
        <Text style={summary.label}>30-day avg</Text>
      </View>
      <View style={summary.divider} />
      <View style={summary.item}>
        <Text style={summary.value}>{items.length}</Text>
        <Text style={summary.label}>medication{items.length !== 1 ? 's' : ''}</Text>
      </View>
      {maxStreak > 0 && (
        <>
          <View style={summary.divider} />
          <View style={summary.item}>
            <Text style={summary.value}>🔥 {maxStreak}d</Text>
            <Text style={summary.label}>best streak</Text>
          </View>
        </>
      )}
    </View>
  );
}

const summary = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#1A2F5A',
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  item: { alignItems: 'center', gap: 2 },
  value: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  label: { fontSize: 11, color: '#94A3B8' },
  divider: { width: 1, height: 32, backgroundColor: '#2D4A7A' },
});

// ─── Export helper ────────────────────────────────────────────────────────────

function buildExportText(entity: Entity, items: MedicationCompliance[]): string {
  const lines: string[] = [
    `Compliance Report — ${entity.name}`,
    `Generated: ${new Date().toLocaleDateString()}`,
    '',
  ];
  for (const item of items) {
    const { medication: med, adherence7, adherence30, adherence90, avgOffsetMinutes, streak } = item;
    lines.push(`${med.name} (${med.dosage})`);
    lines.push(`  Adherence: 7d ${adherence7 ?? '—'}%  30d ${adherence30 ?? '—'}%  90d ${adherence90 ?? '—'}%`);
    lines.push(`  Timing: ${offsetLabel(avgOffsetMinutes)}`);
    if (streak > 0) lines.push(`  Streak: ${streak} days`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ComplianceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [items, setItems] = useState<MedicationCompliance[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [e, data] = await Promise.all([getEntity(id), getEntityCompliance(id)]);
    setEntity(e);
    setItems(data);
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleExport() {
    if (!entity) return;
    const text = buildExportText(entity, items);
    await Share.share({ message: text, title: `${entity.name} — Compliance Report` });
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#4A90D9" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Compliance</Text>
          {entity && <Text style={styles.headerSub}>{entity.name}</Text>}
        </View>
        <TouchableOpacity onPress={handleExport} style={styles.exportBtn}>
          <Text style={styles.exportText}>Share</Text>
        </TouchableOpacity>
      </View>

      <SummaryBar items={items} />

      <ScrollView contentContainerStyle={styles.list}>
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyTitle}>No data yet</Text>
            <Text style={styles.emptySub}>
              Compliance tracking starts once scheduled doses are logged.
            </Text>
          </View>
        ) : (
          items.map((item) => (
            <ComplianceCard key={item.medication.id} item={item} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 4, marginRight: 8, width: 28 },
  backText: { fontSize: 24, color: '#4A90D9', lineHeight: 28 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },
  headerSub: { fontSize: 12, color: '#64748B', marginTop: 1 },
  exportBtn: { padding: 8 },
  exportText: { fontSize: 15, color: '#4A90D9', fontWeight: '600' },
  list: { padding: 16, gap: 14 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 80 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1A2F5A' },
  emptySub: { fontSize: 14, color: '#64748B', textAlign: 'center', paddingHorizontal: 40 },
});
