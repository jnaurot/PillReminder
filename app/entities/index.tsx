import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert, RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEntities, deleteEntity } from '../../src/db/entities';
import { getDosesForDate, todayStr } from '../../src/db/doseLogs';
import type { Entity } from '../../src/types';

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

interface DoseStatus { pending: number; total: number }

function DoseBadge({ status }: { status: DoseStatus | undefined }) {
  if (!status || status.total === 0) return null;
  const allDone = status.pending === 0;
  return (
    <View style={[styles.doseBadge, allDone && styles.doseBadgeDone]}>
      <Text style={[styles.doseBadgeText, allDone && styles.doseBadgeTextDone]}>
        {allDone ? '✓ all done' : `${status.pending} pending`}
      </Text>
    </View>
  );
}

function EntityCard({
  entity,
  doseStatus,
  onDelete,
}: {
  entity: Entity;
  doseStatus: DoseStatus | undefined;
  onDelete: () => void;
}) {
  function confirmDelete() {
    Alert.alert(
      'Remove entity',
      `Remove "${entity.name}" and all their medications?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteEntity(entity.id);
            onDelete();
          },
        },
      ]
    );
  }

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/entities/${entity.id}`)}
      onLongPress={confirmDelete}
      activeOpacity={0.7}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(entity.name)}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName}>{entity.name}</Text>
        {entity.dob ? <Text style={styles.cardSub}>DOB: {entity.dob}</Text> : null}
        {entity.notes ? <Text style={styles.cardNotes} numberOfLines={1}>{entity.notes}</Text> : null}
      </View>
      <View style={styles.cardRight}>
        <DoseBadge status={doseStatus} />
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function EntitiesScreen() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [statusMap, setStatusMap] = useState<Map<string, DoseStatus>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await getEntities();
    setEntities(rows);

    const today = todayStr();
    const entries = await Promise.all(
      rows.map(async (e) => {
        const doses = await getDosesForDate(e.id, today);
        const pending = doses.filter((d) => d.status === 'due' || d.status === 'missed').length;
        return [e.id, { pending, total: doses.length }] as [string, DoseStatus];
      })
    );
    setStatusMap(new Map(entries));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsBtn}>
          <Text style={styles.settingsText}>⚙</Text>
        </TouchableOpacity>
        <Text style={styles.title}>People</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => router.push('/entities/new')}>
          <Text style={styles.addButtonText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {entities.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>👤</Text>
          <Text style={styles.emptyTitle}>No one added yet</Text>
          <Text style={styles.emptySub}>Tap "+ Add" to create your first person</Text>
        </View>
      ) : (
        <FlatList
          data={entities}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <EntityCard
              entity={item}
              doseStatus={statusMap.get(item.id)}
              onDelete={load}
            />
          )}
          contentContainerStyle={styles.list}
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
    paddingHorizontal: 20, paddingVertical: 16,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  title: { fontSize: 22, fontWeight: '700', color: '#1A2F5A' },
  addButton: { backgroundColor: '#4A90D9', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  settingsBtn: { padding: 4 },
  settingsText: { fontSize: 22, color: '#4A90D9' },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#4A90D9', alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  avatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  cardBody: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '600', color: '#1A2F5A' },
  cardSub: { fontSize: 13, color: '#64748B', marginTop: 2 },
  cardNotes: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  chevron: { fontSize: 24, color: '#CBD5E1' },
  doseBadge: {
    backgroundColor: '#FFF7ED', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  doseBadgeDone: { backgroundColor: '#F0FDF4' },
  doseBadgeText: { fontSize: 11, fontWeight: '700', color: '#C2410C' },
  doseBadgeTextDone: { color: '#16A34A' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1A2F5A' },
  emptySub: { fontSize: 14, color: '#64748B', textAlign: 'center', paddingHorizontal: 40 },
});
