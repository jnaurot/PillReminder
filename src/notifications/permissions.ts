import { Platform } from 'react-native';
import Constants from 'expo-constants';

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Constants.executionEnvironment === 'storeClient') return false;

  // Lazy-load so the module never initialises in Expo Go.
  const Notifications = await import('expo-notifications');

  if (Platform.OS === 'android') {
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
    // Alarm channels v3 — single 5-second burst instead of pulse train,
    // to test whether Android cuts off multi-element patterns early.
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
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  if (existing === 'denied') return false;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}
