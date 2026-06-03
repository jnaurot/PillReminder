import { NativeModules, Platform } from 'react-native';

const { AlarmScheduler } = NativeModules;

// djb2 hash → positive integer in Java signed-int range [1, 2147483647]
function hashId(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return (h % 2147483647) + 1;
}

function ensureModule(): void {
  if (Platform.OS !== 'android') throw new Error('AlarmScheduler is Android-only');
  if (!AlarmScheduler) throw new Error('AlarmScheduler native module is not linked. Was the Android build refreshed after adding the native module?');
}

export function scheduleAlarmNative(
  id: string,
  title: string,
  body: string,
  fireTimeMs: number,
  channelId: string,
): void {
  ensureModule();
  AlarmScheduler.scheduleAlarm(hashId(id), title, body, fireTimeMs, channelId);
}

export function cancelAlarmNative(id: string): void {
  ensureModule();
  AlarmScheduler.cancelAlarm(hashId(id));
}

export function dismissActiveAlarmNative(): void {
  ensureModule();
  AlarmScheduler.dismissActiveAlarm();
}
