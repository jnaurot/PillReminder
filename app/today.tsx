import { useCallback, useState } from 'react';
import {
  View, Text, SectionList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAllDosesForDate, todayStr, type ScheduledDose, type EntityDoses } from '../src/db/doseLogs';
import { DoseCard } from '../src/components/DoseCard';
import { setBadge } from '../src/notifications/scheduler';
import { getActiveShift, type ShiftWithCaregiver } from '../src/db/caregivers';

type Section = EntityDoses & { data: ScheduledDose[] };

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

export default function TodayScreen() {
  const [sections, setSections] = useState<Section[]>([]);
  const [activeShift, setActiveShift] = useState<ShiftWithCaregiver | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const date = todayStr();

  const [delegatedIds, setDelegatedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [all, shift] = await Promise.all([getAllDosesForDate(date), getActiveShift()]);
    setSections(all.map((e) => ({ ...e, data: e.doses })));
    setActiveShift(shift);

    // Build the set of entity IDs currently delegated to a caregiver.
    if (shift) {
      try {
        const ids: string[] = JSON.parse(shift.entity_ids);
        setDelegatedIds(ids.includes('*') ? new Set(all.map((e) => e.entityId)) : new Set(ids));
      } catch {
        setDelegatedIds(new Set());
      }
    } else {
      setDelegatedIds(new Set());
    }

    setLoading(false);
    const actionableCount = all.flatMap((e) => e.doses)
      .filter((d) => d.status === 'due' || d.status === 'missed').length;
    await setBadge(actionableCount);
  }, [date]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const allDoses = sections.flatMap((s) => s.doses);
  const actionable = allDoses.filter((d) => d.status === 'due' || d.status === 'missed');
  const settled    = allDoses.filter((d) => d.status === 'taken' || d.status === 'skipped');

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#4A90D9" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Today</Text>
          <Text style={styles.headerDate}>{dateLabel}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.peopleBtn}
            onPress={() => router.push('/entities')}
          >
            <Text style={styles.peopleBtnText}>People ›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsBtn}>
            <Text style={styles.settingsText}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Active caregiver banner — only shown on the primary's device */}
      {activeShift && activeShift.primary_phone === '' && (
        <TouchableOpacity style={styles.caregiverBanner} onPress={() => router.push('/caregivers')}>
          <View>
            <Text style={styles.caregiverBannerTitle}>🤝 Active caregiver: {activeShift.caregiver.name}</Text>
            <Text style={styles.caregiverBannerSub}>
              Until {new Date(activeShift.end_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          <Text style={styles.caregiverBannerChevron}>›</Text>
        </TouchableOpacity>
      )}
      {/* On-shift banner — shown on the caregiver's device */}
      {activeShift && activeShift.primary_phone !== '' && (
        <TouchableOpacity style={styles.onShiftBanner} onPress={() => router.push('/caregivers')}>
          <Text style={styles.caregiverBannerTitle}>🤝 You are on shift as caregiver</Text>
          <Text style={styles.caregiverBannerChevron}>›</Text>
        </TouchableOpacity>
      )}

      {/* Summary banner */}
      {allDoses.length > 0 && (
        <View style={[
          styles.summaryBanner,
          actionable.length === 0 && styles.summaryBannerGreen,
        ]}>
          {actionable.length > 0 ? (
            <Text style={styles.summaryText}>
              {actionable.length} need{actionable.length === 1 ? 's' : ''} attention
              {settled.length > 0 ? `  ·  ${settled.length} done` : ''}
            </Text>
          ) : (
            <Text style={[styles.summaryText, styles.summaryTextGreen]}>
              ✓  All doses accounted for
            </Text>
          )}
        </View>
      )}

      {sections.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💊</Text>
          <Text style={styles.emptyTitle}>Nothing scheduled today</Text>
          <Text style={styles.emptySub}>
            Add people and their medications to see today's doses here.
          </Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => router.push('/entities')}
          >
            <Text style={styles.emptyBtnText}>Manage People</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderSectionHeader={({ section }) => (
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => router.push(`/entities/${section.entityId}`)}
              activeOpacity={0.7}
            >
              <View style={styles.sectionAvatar}>
                <Text style={styles.sectionAvatarText}>{initials(section.entityName)}</Text>
              </View>
              <Text style={styles.sectionName}>{section.entityName}</Text>
              <Text style={styles.sectionChevron}>›</Text>
            </TouchableOpacity>
          )}
          renderItem={({ item, section }) => (
            <DoseCard
              dose={item}
              allDoses={section.doses}
              onAction={load}
              isDelegated={delegatedIds.has(section.entityId)}
            />
          )}
          contentContainerStyle={styles.list}
          SectionSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#1A2F5A' },
  headerDate:  { fontSize: 12, color: '#94A3B8', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  peopleBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: '#F1F5F9', borderRadius: 16,
  },
  peopleBtnText: { fontSize: 13, fontWeight: '600', color: '#4A90D9' },
  settingsBtn: { padding: 4 },
  settingsText: { fontSize: 22, color: '#4A90D9' },
  summaryBanner: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 20, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#FED7AA',
  },
  summaryBannerGreen: {
    backgroundColor: '#F0FDF4',
    borderBottomColor: '#BBF7D0',
  },
  summaryText: { fontSize: 13, fontWeight: '600', color: '#C2410C' },
  summaryTextGreen: { color: '#16A34A' },
  list: { padding: 16, paddingTop: 8, gap: 8 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8,
  },
  sectionAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#4A90D9', alignItems: 'center', justifyContent: 'center',
  },
  sectionAvatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  sectionName: { flex: 1, fontSize: 14, fontWeight: '700', color: '#1A2F5A' },
  sectionChevron: { fontSize: 18, color: '#CBD5E1' },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingHorizontal: 40,
  },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1A2F5A' },
  emptySub:   { fontSize: 14, color: '#64748B', textAlign: 'center' },
  emptyBtn: {
    marginTop: 8, paddingHorizontal: 24, paddingVertical: 12,
    backgroundColor: '#4A90D9', borderRadius: 20,
  },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
  caregiverBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#14532D', paddingHorizontal: 20, paddingVertical: 10,
  },
  caregiverBannerTitle: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  caregiverBannerSub: { fontSize: 11, color: '#86EFAC', marginTop: 1 },
  caregiverBannerChevron: { fontSize: 20, color: '#86EFAC' },
  onShiftBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1E40AF', paddingHorizontal: 20, paddingVertical: 10,
  },
});
