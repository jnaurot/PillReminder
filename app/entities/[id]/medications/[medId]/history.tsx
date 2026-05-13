import { useCallback, useState } from 'react';
import {
  View, Text, SectionList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMedication } from '../../../../../src/db/medications';
import { getLogsForMedication, deleteLog, updateLogNote } from '../../../../../src/db/doseLogs';
import { getCaregivers } from '../../../../../src/db/caregivers';
import { getSettings } from '../../../../../src/db/settings';
import type { DoseLog, Medication } from '../../../../../src/types';
import { dateToStr, nDaysAgo } from '../../../../../src/utils/dateTime';

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function fmtDate(dateS: string): string {
  return new Date(`${dateS}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface LogSection {
  title: string;
  data: DoseLog[];
}

export default function MedicationHistoryScreen() {
  const { id, medId } = useLocalSearchParams<{ id: string; medId: string }>();
  const [medication, setMedication] = useState<Medication | null>(null);
  const [sections, setSections] = useState<LogSection[]>([]);
  const [caregiverNames, setCaregiverNames] = useState<Map<string, string>>(new Map());
  const [primaryName, setPrimaryName] = useState('Primary Caregiver');
  const [loading, setLoading] = useState(true);

  async function load() {
    const today = dateToStr(nDaysAgo(0));
    const from = dateToStr(nDaysAgo(89));
    const [med, logs, caregivers, settings] = await Promise.all([
      getMedication(medId),
      getLogsForMedication(medId, `${from}T00:00:00`, `${today}T23:59:59`),
      getCaregivers(),
      getSettings(),
    ]);
    setMedication(med);
    setCaregiverNames(new Map(caregivers.map((c) => [c.id, c.name])));
    setPrimaryName(settings.primary_name);

    // Group by calendar date, newest first
    const byDate = new Map<string, DoseLog[]>();
    for (const log of [...logs].reverse()) {
      const d = dateOnly(log.scheduled_at ?? log.created_at);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(log);
    }
    setSections(
      [...byDate.entries()].map(([date, data]) => ({ title: fmtDate(date), data }))
    );
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { load(); }, [medId]));

  function handleLongPress(log: DoseLog) {
    const verb = log.skipped ? 'skipped' : 'taken';
    Alert.alert(
      `Dose ${verb}`,
      `${fmtTime(log.taken_at ?? log.scheduled_at)}${log.notes ? `\n${log.notes}` : ''}`,
      [
        {
          text: log.notes ? 'Edit note' : 'Add note',
          onPress: () => {
            Alert.prompt(
              'Dose note',
              'Enter a note for this dose:',
              async (text) => { await updateLogNote(log.id, text?.trim() || null); load(); },
              'plain-text',
              log.notes ?? '',
            );
          },
        },
        {
          text: 'Delete entry',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Delete log entry', 'Remove this dose record?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => { await deleteLog(log.id); load(); } },
            ]),
        },
        { text: 'Cancel', style: 'cancel' },
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}> ‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {medication?.name ?? ''} — History
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {sections.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No history yet</Text>
          <Text style={styles.emptySub}>Logged doses appear here (last 90 days).</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionDate}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item: log }) => {
            const taken = !log.skipped;
            return (
              <TouchableOpacity
                style={styles.logRow}
                onLongPress={() => handleLongPress(log)}
                delayLongPress={400}
                activeOpacity={0.75}
              >
                <View style={[styles.dot, taken ? styles.dotTaken : styles.dotSkipped]} />
                <View style={styles.logBody}>
                  <Text style={styles.logStatus}>
                    {taken ? 'Taken' : 'Skipped'}
                    {log.is_catchup ? '  ·  catch-up' : ''}
                  </Text>
                  {log.taken_at && (
                    <Text style={styles.logTime}>{fmtTime(log.taken_at)}</Text>
                  )}
                  {log.scheduled_at && (
                    <Text style={styles.logScheduled}>Scheduled {fmtTime(log.scheduled_at)}</Text>
                  )}
                  <Text style={styles.logLogger}>
                    {log.caregiver_id
                      ? (caregiverNames.get(log.caregiver_id) ?? 'Caregiver')
                      : primaryName}
                  </Text>
                  {log.notes ? <Text style={styles.logNote}>📝 {log.notes}</Text> : null}
                </View>
                <Text style={styles.hint}>hold</Text>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled
        />
      )}
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
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1A2F5A', textAlign: 'center' },
  list: { paddingBottom: 32 },
  sectionHeader: {
    backgroundColor: '#F0F4FA', paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  sectionDate: {
    fontSize: 12, fontWeight: '700', color: '#475569',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  logRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, marginRight: 12 },
  dotTaken:   { backgroundColor: '#16A34A' },
  dotSkipped: { backgroundColor: '#CA8A04' },
  logBody: { flex: 1, gap: 2 },
  logStatus:    { fontSize: 14, fontWeight: '600', color: '#1A2F5A' },
  logTime:      { fontSize: 13, color: '#4A90D9' },
  logScheduled: { fontSize: 12, color: '#94A3B8' },
  logLogger:    { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  logNote:      { fontSize: 12, color: '#64748B', fontStyle: 'italic', marginTop: 2 },
  hint:         { fontSize: 10, color: '#CBD5E1', alignSelf: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1A2F5A' },
  emptySub:   { fontSize: 14, color: '#64748B', textAlign: 'center' },
});
