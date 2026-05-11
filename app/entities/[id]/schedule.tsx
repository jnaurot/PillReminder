import { useCallback, useRef, useState } from 'react';
import {
  View, Text, SectionList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDosesForDate, todayStr, type ScheduledDose } from '../../../src/db/doseLogs';
import { getDb } from '../../../src/db/database';
import { DoseCard } from '../../../src/components/DoseCard';
import {
  addDays,
  formatHeader,
  formatSubtitle,
  buildSection,
  INITIAL_PAST_DAYS,
  LOAD_MORE_BATCH,
  type ScheduleSection,
  type SectionItem,
} from '../../../src/utils/scheduleDates';

// ─── Component ─────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = todayStr();
  const listRef = useRef<SectionList<SectionItem, ScheduleSection>>(null);

  const [sections, setSections] = useState<ScheduleSection[]>([]);
  const [minDate, setMinDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Find earliest dose log date for this entity (earliest dosing information)
  const findMinDate = useCallback(async () => {
    try {
      const row = await getDb().getFirstAsync<{ earliest: string }>(
        `SELECT MIN(substr(dl.scheduled_at, 1, 10)) as earliest
         FROM dose_logs dl
         JOIN medications m ON dl.medication_id = m.id
         WHERE m.entity_id = ? AND m.deleted_at IS NULL`,
        [id],
      );
      if (row?.earliest) {
        setMinDate(row.earliest);
        return row.earliest;
      }
    } catch {}
    setMinDate(today);
    return today;
  }, [id, today]);

  // Initial load: today first, then past dates down to minDate
  const loadInitial = useCallback(async () => {
    setLoading(true);
    const minD = await findMinDate();

    const dates: string[] = [];
    let d = today;
    let count = 0;
    while (d >= minD && count <= INITIAL_PAST_DAYS) {
      dates.push(d);
      d = addDays(d, -1);
      count++;
    }

    const newSections = await Promise.all(
      dates.map(async (d) => buildSection(d, await getDosesForDate(id, d), today)),
    );
    setSections(newSections);
    setHasMore(minD < addDays(dates[dates.length - 1] ?? today, -1));
    setLoading(false);
  }, [findMinDate, id, today]);

  // Load more past dates when user scrolls to the bottom
  const loadMorePast = useCallback(async () => {
    if (loadingMore || !hasMore || sections.length === 0) return;
    setLoadingMore(true);

    const lastDate = sections[sections.length - 1].dateStr;
    const nextEnd = addDays(lastDate, -LOAD_MORE_BATCH);
    const actualEnd = nextEnd < minDate ? minDate : nextEnd;

    const dates: string[] = [];
    for (let d = addDays(lastDate, -1); d >= actualEnd; d = addDays(d, -1)) {
      dates.push(d);
    }

    if (dates.length === 0) {
      setHasMore(false);
      setLoadingMore(false);
      return;
    }

    const newSections = await Promise.all(
      dates.map(async (d) => buildSection(d, await getDosesForDate(id, d), today)),
    );

    setSections((prev) => [...prev, ...newSections]);
    setHasMore(actualEnd > minDate);
    setLoadingMore(false);
  }, [loadingMore, hasMore, sections, minDate, id, today]);

  // Reload all currently visible dates after a dose action
  const handleReload = useCallback(async () => {
    if (sections.length === 0) return;
    const currentDates = sections.map((s) => s.dateStr);
    const newSections = await Promise.all(
      currentDates.map(async (d) => buildSection(d, await getDosesForDate(id, d), today)),
    );
    setSections(newSections);
  }, [sections, id, today]);

  async function handleRefresh() {
    setRefreshing(true);
    await handleReload();
    setRefreshing(false);
  }

  useFocusEffect(
    useCallback(() => {
      if (sections.length === 0) {
        loadInitial();
      } else {
        handleReload();
      }
    }, [loadInitial, handleReload, sections.length]),
  );

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const renderSectionHeader = useCallback(
    ({ section }: { section: ScheduleSection }) => (
      <View
        style={[
          styles.sectionHeader,
          section.isFuture && styles.sectionHeaderFuture,
          section.isToday && styles.sectionHeaderToday,
        ]}
      >
        <Text
          style={[
            styles.sectionHeaderTitle,
            section.isFuture && styles.sectionHeaderTitleFuture,
          ]}
        >
          {section.header}
        </Text>
        <Text style={styles.sectionHeaderSub}>{section.subHeader}</Text>
      </View>
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item, section }: { item: SectionItem; section: ScheduleSection }) => {
      if ('isPlaceholder' in item) {
        return (
          <View style={styles.emptyDay}>
            <Text style={styles.emptyDayText}>No doses scheduled</Text>
          </View>
        );
      }
      return (
        <View style={section.isFuture ? styles.itemFuture : undefined}>
          <DoseCard
            dose={item}
            allDoses={section.data.filter((d): d is ScheduledDose => !('isPlaceholder' in d))}
            onAction={handleReload}
          />
        </View>
      );
    },
    [handleReload],
  );

  const renderSectionFooter = useCallback(
    ({ section }: { section: ScheduleSection }) => {
      if (section.isToday) {
        const realDoses = section.data.filter((d): d is ScheduledDose => !('isPlaceholder' in d));
        const actionable = realDoses.filter((d) => d.status === 'due' || d.status === 'missed');
        const settled = realDoses.filter((d) => d.status === 'taken' || d.status === 'skipped');
        return (
          <View style={styles.todayFooter}>
            {actionable.length > 0 ? (
              <Text style={styles.summaryText}>
                {actionable.length} action{actionable.length !== 1 ? 's' : ''} needed · {settled.length} done
              </Text>
            ) : (
              <Text style={[styles.summaryText, styles.summaryTextGreen]}>
                ✓ All doses accounted for
              </Text>
            )}
          </View>
        );
      }
      if (section.isPast) {
        return (
          <View style={styles.retroFooter}>
            <Text style={styles.retroText}>
              Past date — doses recorded as taken at their scheduled time.
            </Text>
          </View>
        );
      }
      return null;
    },
    [],
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}> ‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Schedule</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#4A90D9" />
        </View>
      ) : (
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(item) => ('isPlaceholder' in item ? item.key : item.key)}
          renderSectionHeader={renderSectionHeader}
          renderItem={renderItem}
          renderSectionFooter={renderSectionFooter}
          stickySectionHeadersEnabled={true}
          onEndReached={loadMorePast}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          contentContainerStyle={styles.list}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadMore}>
                <ActivityIndicator size="small" color="#4A90D9" />
                <Text style={styles.loadMoreText}>Loading more dates…</Text>
              </View>
            ) : !hasMore && sections.length > 0 ? (
              <View style={styles.loadMore}>
                <Text style={styles.loadMoreText}>Reached earliest record</Text>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 10 },
  backText: { fontSize: 16, color: '#4A90D9', fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },

  list: { paddingHorizontal: 16, paddingTop: 8, gap: 8, paddingBottom: 24 },

  sectionHeader: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    marginHorizontal: -16,
  },
  sectionHeaderFuture: { backgroundColor: '#F8FAFC' },
  sectionHeaderToday: { backgroundColor: '#FFF7ED' },
  sectionHeaderTitle: { fontSize: 15, fontWeight: '700', color: '#1A2F5A' },
  sectionHeaderTitleFuture: { color: '#94A3B8' },
  sectionHeaderSub: { fontSize: 11, color: '#94A3B8', marginTop: 1 },

  itemFuture: { opacity: 0.85 },

  emptyDay: {
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginVertical: 4,
  },
  emptyDayText: { fontSize: 13, color: '#CBD5E1', fontWeight: '500' },

  todayFooter: {
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 12,
  },
  summaryText: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  summaryTextGreen: { color: '#16A34A' },

  retroFooter: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
    marginHorizontal: -16,
  },
  retroText: { fontSize: 12, color: '#92400E', textAlign: 'center' },

  loadMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  loadMoreText: { fontSize: 12, color: '#94A3B8' },
});
