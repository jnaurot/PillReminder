import { useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { initDb, getDb } from '../src/db/database';

const isExpoGo = Constants.executionEnvironment === 'storeClient';

// Resolve the entity schedule path for a notification's data payload.
async function schedulePathForNotif(data: Record<string, unknown>): Promise<string | null> {
  const medId = data?.medId;
  if (typeof medId !== 'string') return null;
  try {
    const db = getDb();
    const row = await db.getFirstAsync<{ entity_id: string }>(
      'SELECT entity_id FROM medications WHERE id = ?',
      [medId],
    );
    if (!row) return null;
    return `/entities/${row.entity_id}/schedule`;
  } catch {
    return null;
  }
}

async function initNotifications() {
  if (isExpoGo) return;
  const { setNotificationHandler } = await import('expo-notifications');
  const { requestNotificationPermissions } = await import('../src/notifications/permissions');
  const { rescheduleAll } = await import('../src/notifications/scheduler');

  setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  const granted = await requestNotificationPermissions();
  if (granted) await rescheduleAll();
}

// Module-level store for a cold-start notification deep-link.
// index.tsx calls consumePendingNotifRoute() after its auth redirect.
let _pendingNotifRoute: string | null = null;
export function consumePendingNotifRoute(): string | null {
  const r = _pendingNotifRoute;
  _pendingNotifRoute = null;
  return r;
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const listenerRef = useRef<{ remove(): void } | null>(null);

  useEffect(() => {
    async function init() {
      await initDb();
      await initNotifications();

      if (!isExpoGo) {
        const N = await import('expo-notifications');

        // Cold-start: app was not running when user tapped the notification.
        const last = await N.getLastNotificationResponseAsync();
        if (last) {
          const path = await schedulePathForNotif(
            last.notification.request.content.data as Record<string, unknown>,
          );
          if (path) _pendingNotifRoute = path;
        }

        // Foreground / background: app already running, user taps notification.
        listenerRef.current = N.addNotificationResponseReceivedListener(
          async (response) => {
            const path = await schedulePathForNotif(
              response.notification.request.content.data as Record<string, unknown>,
            );
            if (path) router.push(path as any);
          },
        );
      }

      setReady(true);
    }
    init();

    return () => {
      listenerRef.current?.remove();
    };
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#4A90D9" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="today" />
        <Stack.Screen name="entities/index" />
        <Stack.Screen name="entities/new" />
        <Stack.Screen name="entities/[id]/index" />
        <Stack.Screen name="entities/[id]/edit" />
        <Stack.Screen name="entities/[id]/schedule" />
        <Stack.Screen name="entities/[id]/medications/new" />
        <Stack.Screen name="entities/[id]/medications/[medId]/edit" />
        <Stack.Screen name="entities/[id]/medications/[medId]/refill" />
        <Stack.Screen name="entities/[id]/medications/[medId]/history" />
        <Stack.Screen name="entities/[id]/compliance" />
        <Stack.Screen name="settings" />
      </Stack>
    </SafeAreaProvider>
  );
}
