import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface NotificationPermissionStatus {
  state: NotificationPermissionState;
  canAskAgain: boolean;
}

async function loadNotificationsModule() {
  return import('expo-notifications');
}

async function ensureChannels(): Promise<void> {
  if (Constants.executionEnvironment === 'storeClient') return;

  const Notifications = await loadNotificationsModule();
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('dose-reminders', {
    name: 'Dose Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync('missed-doses', {
    name: 'Missed Doses',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  });
  const ALARM_VIBRATION: number[] = [0, 5000];
  await Notifications.setNotificationChannelAsync('dose-alarm-v3', {
    name: 'Dose Alarms (Sound + Vibration)',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: ALARM_VIBRATION,
    enableLights: true,
    lightColor: '#FF3B30',
  });
  await Notifications.setNotificationChannelAsync('dose-alarm-sound-v3', {
    name: 'Dose Alarms (Sound only)',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: null,
  });
  await Notifications.setNotificationChannelAsync('dose-alarm-vibrate-v3', {
    name: 'Dose Alarms (Vibration only)',
    importance: Notifications.AndroidImportance.MAX,
    sound: null,
    vibrationPattern: ALARM_VIBRATION,
  });
  await Notifications.setNotificationChannelAsync('dose-alarm-silent-v3', {
    name: 'Dose Alarms (Silent)',
    importance: Notifications.AndroidImportance.MAX,
    sound: null,
    vibrationPattern: null,
    enableLights: true,
    lightColor: '#FF3B30',
  });
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (Constants.executionEnvironment === 'storeClient') {
    return { state: 'unavailable', canAskAgain: false };
  }

  const Notifications = await loadNotificationsModule();
  const settings = await Notifications.getPermissionsAsync();
  return {
    state: settings.status as NotificationPermissionState,
    canAskAgain: settings.canAskAgain ?? false,
  };
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Constants.executionEnvironment === 'storeClient') return false;

  const Notifications = await loadNotificationsModule();
  await ensureChannels();

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  if (existing.status === 'denied' && existing.canAskAgain === false) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}
