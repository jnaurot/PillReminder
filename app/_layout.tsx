import { useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { Alert, View, ActivityIndicator, Vibration } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
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
  const { setNotificationHandler, addNotificationReceivedListener } = await import('expo-notifications');
  const { requestNotificationPermissions } = await import('../src/notifications/permissions');
  const { rescheduleAll } = await import('../src/notifications/scheduler');

  setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  // Foreground: vibrate directly when an alarm/test notification arrives.
  addNotificationReceivedListener((notification) => {
    const type = (notification.request.content.data as any)?.type;
    if (type === 'alarm' || type === 'test') {
      Vibration.vibrate([0, 5000]);
    }
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

// Module-level store for a cold-start deep link (e.g. pillreminder://caregivers/incoming?d=...).
// index.tsx calls consumePendingDeepLink() after auth to route the user.
let _pendingDeepLink: string | null = null;
export function consumePendingDeepLink(): string | null {
  const r = _pendingDeepLink;
  _pendingDeepLink = null;
  return r;
}

function extractDeepLinkPath(url: string): string | null {
  try {
    const parsed = Linking.parse(url);
    // parsed.path is e.g. "caregivers/incoming", params includes { d: '...' }
    if (!parsed.path) return null;
    const qs = parsed.queryParams
      ? Object.entries(parsed.queryParams)
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return qs ? `/${parsed.path}?${qs}` : `/${parsed.path}`;
  } catch {
    return null;
  }
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const listenerRef = useRef<{ remove(): void } | null>(null);
  const deepLinkListenerRef = useRef<{ remove(): void } | null>(null);

  useEffect(() => {
    async function init() {
      await initDb();
      import('../src/services/rxnorm').then(({ enrichAllUnenriched }) =>
        enrichAllUnenriched().catch(() => {})
      );
      await initNotifications();

      // Cold-start deep link: app was launched via a pillreminder:// URL.
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl && initialUrl.startsWith('pillreminder://')) {
        const path = extractDeepLinkPath(initialUrl);
        if (path) _pendingDeepLink = path;
      }

      // Foreground deep link: app already running when the URL is opened.
      deepLinkListenerRef.current = Linking.addEventListener('url', ({ url }) => {
        if (!url.startsWith('pillreminder://')) return;
        const path = extractDeepLinkPath(url);
        if (!path) return;
        // Show a non-interrupting confirmation so the user isn't yanked mid-form.
        Alert.alert(
          'Incoming message',
          'A PillReminder link was received. Open it now?',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Open', onPress: () => router.push(path as any) },
          ],
        );
      });

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
            const notifId = response.notification.request.identifier;
            if (notifId) await N.dismissNotificationAsync(notifId).catch(() => {});
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
      deepLinkListenerRef.current?.remove();
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
        <Stack.Screen name="entities/[id]/medications/[medId]/index" />
        <Stack.Screen name="entities/[id]/medications/[medId]/edit" />
        <Stack.Screen name="entities/[id]/medications/[medId]/refill" />
        <Stack.Screen name="entities/[id]/medications/[medId]/history" />
        <Stack.Screen name="entities/[id]/compliance" />
        <Stack.Screen name="caregivers/index" />
        <Stack.Screen name="caregivers/shift/new" />
        <Stack.Screen name="caregivers/incoming" />
        <Stack.Screen name="settings" />
      </Stack>
    </SafeAreaProvider>
  );
}
