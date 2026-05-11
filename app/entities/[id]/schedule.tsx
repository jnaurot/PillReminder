import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDosesForDate, todayStr, type ScheduledDose } from '../../../src/db/doseLogs';
import { getDb } from '../../../src/db/database';
import { DoseCard } from '../../../src/components/DoseCard';

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return dateStr(d);
}

function formatHeader(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatSubtitle(date: string, today: string): string {
  if (date === today) {
    return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function ScheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [doses, setDoses] = useState<ScheduledDose[]>([]);
  const [minDate, setMinDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await getDosesForDate(id, date);
    setDoses(result);
    try {
      const row = await getDb().getFirstAsync<{ earliest: string }>(
        `SELECT MIN(created_at) as earliest FROM medications WHERE entity_id = ? AND deleted_at IS NULL`,
        [id],
      );
      if (row?.earliest) setMinDate(dateStr(new Date(row.earliest)));
    } catch {}
    setLoading(false);
  }, [id, date]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function goBack()    { setLoading(true); setDate((d) => addDays(d, -1)); }
  function goForward() { setLoading(true); setDate((d) => addDays(d, +1)); }

  const isPast    = date < today;
  const isToday   = date === today;
  const isMinDate = date <= minDate;
  const actionable = doses.filter((d) => d.status === 'due' || d.status === 'missed');
  const settled    = doses.filter((d) => d.status === 'taken' || d.status === 'skipped');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Main header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}> ‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Schedule</Text>
        <View style={{ width: 28 }} />
      </View>

      {/* Date navigation bar */}
      <View style={styles.dateBar}>
        <TouchableOpacity
          onPress={goBack}
          style={[styles.dateNavBtn, isMinDate && styles.dateNavBtnDisabled]}
          disabled={isMinDate}
        >
          <Text style={styles.dateNavArrow}>←</Text>
          <Text style={styles.dateNavLabel}>Prev</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => { setLoading(true); setDate(today); }}
          disabled={isToday}
          style={styles.dateCenterBtn}
        >
          <Text style={styles.dateCenterTitle}>{formatHeader(date, today)}</Text>
          <Text style={styles.dateCenterSub}>{formatSubtitle(date, today)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={goForward}
          style={[styles.dateNavBtn, isToday && styles.dateNavBtnDisabled]}
          disabled={isToday}
        >
          <Text style={styles.dateNavLabel}>Next</Text>
          <Text style={styles.dateNavArrow}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Retroactive notice */}
      {isPast && (
        <View style={styles.retroBanner}>
          <Text style={styles.retroText}>
            Past date — doses recorded as taken at their scheduled time.
          </Text>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#4A90D9" />
        </View>
      ) : doses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyTitle}>No doses scheduled</Text>
          <Text style={styles.emptySub}>
            {isToday
              ? 'Add medications with a schedule to see them here.'
              : 'No medications were scheduled on this day.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={doses}
          keyExtractor={(d) => d.key}
          renderItem={({ item }) => (
            <DoseCard dose={item} allDoses={doses} onAction={load} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListHeaderComponent={
            <View style={styles.summary}>
              {actionable.length > 0 ? (
                <Text style={styles.summaryText}>
                  {actionable.length} action{actionable.length !== 1 ? 's' : ''} needed  ·  {settled.length} done
                </Text>
              ) : (
                <Text style={[styles.summaryText, { color: '#16A34A' }]}>
                  ✓ All doses accounted for
                </Text>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 14,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 10 },
  backText: { fontSize: 24, color: '#4A90D9', lineHeight: 28 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },
  dateBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
    paddingVertical: 10, paddingHorizontal: 8,
  },
  dateNavBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: '#F1F5F9', borderRadius: 10,
  },
  dateNavBtnDisabled: { opacity: 0.3 },
  dateNavArrow: { fontSize: 16, color: '#4A90D9', fontWeight: '700' },
  dateNavLabel: { fontSize: 12, color: '#4A90D9', fontWeight: '600' },
  dateCenterBtn: { flex: 1, alignItems: 'center' },
  dateCenterTitle: { fontSize: 15, fontWeight: '700', color: '#1A2F5A' },
  dateCenterSub: { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  retroBanner: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#FDE68A',
  },
  retroText: { fontSize: 12, color: '#92400E', textAlign: 'center' },
  summary: { paddingHorizontal: 4, paddingBottom: 8 },
  summaryText: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  list: { padding: 16, gap: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1A2F5A' },
  emptySub:   { fontSize: 14, color: '#64748B', textAlign: 'center', paddingHorizontal: 40 },
});
