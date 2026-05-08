import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMedication } from '../../../../../src/db/medications';
import { getRefillStatus, type RefillStatus } from '../../../../../src/db/prescriptions';
import { getLogsForMedication } from '../../../../../src/db/doseLogs';
import { getMedicationCompliance, type MedicationCompliance, type DayRecord } from '../../../../../src/db/compliance';
import { getSettings } from '../../../../../src/db/settings';
import { parseSchedule } from '../../../../../src/types';
import type { Medication, DoseLog } from '../../../../../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateHeader(dateStr: string): string {
  const today = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 86400000));
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

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
  return minutes < 0 ? `${Math.abs(minutes)} min early` : `${minutes} min late`;
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
        let bg = '#E2E8F0';
        if (d.scheduled > 0) {
          if (d.missed > 0) bg = '#FCA5A5';
          else if (d.skipped > 0) bg = '#FDE68A';
          else if (d.taken === d.scheduled) bg = '#86EFAC';
        }
        return (
          <View key={d.date} style={dot.cell}>
            <View style={[dot.circle, { backgroundColor: bg }]} />
            <Text style={dot.label}>{new Date(d.date + 'T00:00:00').getDate()}</Text>
          </View>
        );
      })}
    </View>
  );
}

const dot = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { alignItems: 'center', width: 20 },
  circle: { width: 16, height: 16, borderRadius: 8 },
  label: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
});

// ─── Log row ──────────────────────────────────────────────────────────────────

function LogRow({ log }: { log: DoseLog }) {
  const scheduledTime = log.scheduled_at.slice(11, 16);
  const takenTime = log.taken_at
    ? new Date(log.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  let statusLabel = log.is_catchup ? 'Catch-up' : 'Taken';
  let statusBg   = log.is_catchup ? '#EFF6FF' : '#F0FDF4';
  let statusColor = log.is_catchup ? '#2563EB' : '#16A34A';
  if (log.skipped) { statusLabel = 'Skipped'; statusBg = '#FEF9C3'; statusColor = '#A16207'; }

  return (
    <View style={lr.row}>
      <View style={{ flex: 1 }}>
        <Text style={lr.time}>{scheduledTime}</Text>
        {takenTime && !log.skipped && (
          <Text style={lr.takenAt}>→ taken {takenTime}</Text>
        )}
        {log.notes ? <Text style={lr.notes} numberOfLines={2}>📝 {log.notes}</Text> : null}
      </View>
      <View style={[lr.badge, { backgroundColor: statusBg }]}>
        <Text style={[lr.badgeText, { color: statusColor }]}>{statusLabel}</Text>
      </View>
    </View>
  );
}

const lr = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FFFFFF', borderRadius: 10,
    padding: 12, gap: 10,
  },
  time: { fontSize: 15, fontWeight: '600', color: '#1A2F5A' },
  takenAt: { fontSize: 12, color: '#16A34A', marginTop: 2 },
  notes: { fontSize: 12, color: '#64748B', fontStyle: 'italic', marginTop: 3 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MedHistoryScreen() {
  const { id, medId } = useLocalSearchParams<{ id: string; medId: string }>();
  const [medication, setMedication] = useState<Medication | null>(null);
  const [compliance, setCompliance] = useState<MedicationCompliance | null>(null);
  const [refillStatus, setRefillStatus] = useState<RefillStatus | null>(null);
  const [logGroups, setLogGroups] = useState<{ date: string; items: DoseLog[] }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const med = await getMedication(medId);
    if (!med) return;

    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 89);
    const fromStr = `${toDateStr(fromDate)}T00:00:00`;
    const toStr   = `${toDateStr(today)}T23:59:59`;

    const [comp, settings] = await Promise.all([
      getMedicationCompliance(med),
      getSettings(),
    ]);
    const [refill, rawLogs] = await Promise.all([
      getRefillStatus(medId, settings.refill_alert_days),
      getLogsForMedication(medId, fromStr, toStr),
    ]);

    // Most recent first, grouped by date
    const reversed = [...rawLogs].reverse();
    const groups: { date: string; items: DoseLog[] }[] = [];
    for (const log of reversed) {
      const date = log.scheduled_at.slice(0, 10);
      const last = groups[groups.length - 1];
      if (!last || last.date !== date) groups.push({ date, items: [log] });
      else last.items.push(log);
    }

    setMedication(med);
    setCompliance(comp);
    setRefillStatus(refill);
    setLogGroups(groups);
    setLoading(false);
  }, [medId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !medication || !compliance) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#4A90D9" />
      </View>
    );
  }

  const isPrn = parseSchedule(medication.schedule).type === 'prn';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{medication.name}</Text>
          <Text style={styles.headerSub}>{medication.dosage}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push(`/entities/${id}/medications/${medId}/edit`)}>
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Supply card */}
        {refillStatus ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Supply</Text>
              <TouchableOpacity onPress={() => router.push(`/entities/${id}/medications/${medId}/refill`)}>
                <Text style={styles.linkText}>+ Log Refill</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.supplyRow}>
              {refillStatus.daysRemaining !== null && (
                <View style={[styles.supplyPill, refillStatus.isLow && styles.supplyPillLow]}>
                  <Text style={[styles.supplyValue, refillStatus.isLow && styles.supplyValueLow]}>
                    {refillStatus.daysRemaining <= 0 ? 'Empty' : `${refillStatus.daysRemaining}d`}
                  </Text>
                  <Text style={[styles.supplyLabel, refillStatus.isLow && styles.supplyLabelLow]}>remaining</Text>
                </View>
              )}
              <View style={styles.supplyPill}>
                <Text style={styles.supplyValue}>{Math.max(0, refillStatus.unitsRemaining ?? 0)}</Text>
                <Text style={styles.supplyLabel}>{refillStatus.prescription.unit} left</Text>
              </View>
              <View style={styles.supplyPill}>
                <Text style={styles.supplyValue}>{refillStatus.prescription.refill_date.slice(5)}</Text>
                <Text style={styles.supplyLabel}>last filled</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={[styles.card, styles.cardRow]}>
            <Text style={styles.noRefillText}>No refill logged yet.</Text>
            <TouchableOpacity onPress={() => router.push(`/entities/${id}/medications/${medId}/refill`)}>
              <Text style={styles.linkText}>+ Log Refill</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Adherence card */}
        {!isPrn && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Adherence</Text>
            <View style={styles.rateRow}>
              {([
                { label: '7d',  val: compliance.adherence7 },
                { label: '30d', val: compliance.adherence30 },
                { label: '90d', val: compliance.adherence90 },
              ] as const).map(({ label, val }) => (
                <View key={label} style={[styles.ratePill, { backgroundColor: adherenceBg(val) }]}>
                  <Text style={[styles.rateValue, { color: adherenceColor(val) }]}>
                    {val !== null ? `${val}%` : '—'}
                  </Text>
                  <Text style={[styles.ratePeriod, { color: adherenceColor(val) }]}>{label}</Text>
                </View>
              ))}
              {compliance.streak > 0 && (
                <View style={styles.streakBadge}>
                  <Text style={styles.streakText}>🔥 {compliance.streak}d streak</Text>
                </View>
              )}
            </View>
            <View style={styles.timingRow}>
              <Text style={styles.timingLabel}>Avg timing  </Text>
              <Text style={[styles.timingValue, { color: offsetColor(compliance.avgOffsetMinutes) }]}>
                {offsetLabel(compliance.avgOffsetMinutes)}
              </Text>
            </View>
            <Text style={styles.dotGridLabel}>Last 14 days</Text>
            <DotGrid days={compliance.days} />
            <View style={styles.legend}>
              {[
                { color: '#86EFAC', label: 'Taken' },
                { color: '#FDE68A', label: 'Skipped' },
                { color: '#FCA5A5', label: 'Missed' },
              ].map(({ color, label }) => (
                <View key={label} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: color }]} />
                  <Text style={styles.legendText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Dose log */}
        <View style={styles.logSection}>
          <Text style={styles.sectionTitle}>Dose Log  <Text style={styles.sectionSub}>last 90 days</Text></Text>
          {logGroups.length === 0 ? (
            <View style={styles.emptyLog}>
              <Text style={styles.emptyLogText}>No doses logged yet.</Text>
            </View>
          ) : (
            logGroups.map(({ date, items }) => (
              <View key={date} style={styles.logGroup}>
                <Text style={styles.dateHeader}>{formatDateHeader(date)}</Text>
                <View style={styles.logRows}>
                  {items.map((log) => <LogRow key={log.id} log={log} />)}
                </View>
              </View>
            ))
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 14,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 4, marginRight: 8 },
  backText: { fontSize: 24, color: '#4A90D9', lineHeight: 28 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },
  headerSub: { fontSize: 12, color: '#64748B', marginTop: 1 },
  editText: { fontSize: 15, color: '#4A90D9', fontWeight: '600' },
  scroll: { padding: 16, gap: 14 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  linkText: { fontSize: 13, color: '#4A90D9', fontWeight: '600' },
  noRefillText: { fontSize: 14, color: '#94A3B8' },

  supplyRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  supplyPill: {
    backgroundColor: '#F1F5F9', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', minWidth: 72,
  },
  supplyPillLow: { backgroundColor: '#FEF2F2' },
  supplyValue: { fontSize: 18, fontWeight: '700', color: '#1A2F5A' },
  supplyValueLow: { color: '#DC2626' },
  supplyLabel: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  supplyLabelLow: { color: '#DC2626' },

  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  ratePill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, alignItems: 'center', minWidth: 52 },
  rateValue: { fontSize: 16, fontWeight: '700' },
  ratePeriod: { fontSize: 10, fontWeight: '500', marginTop: 1 },
  streakBadge: { backgroundColor: '#FFF7ED', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  streakText: { fontSize: 12, fontWeight: '600', color: '#C2410C' },
  timingRow: { flexDirection: 'row', alignItems: 'center' },
  timingLabel: { fontSize: 12, color: '#64748B' },
  timingValue: { fontSize: 12, fontWeight: '600' },
  dotGridLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '500' },
  legend: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 10, color: '#94A3B8' },

  logSection: { gap: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionSub: { fontSize: 11, fontWeight: '400', color: '#94A3B8', textTransform: 'none', letterSpacing: 0 },
  emptyLog: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 20, alignItems: 'center' },
  emptyLogText: { fontSize: 14, color: '#94A3B8' },
  logGroup: { gap: 6 },
  dateHeader: {
    fontSize: 12, fontWeight: '700', color: '#64748B',
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2,
  },
  logRows: { gap: 6 },
});
