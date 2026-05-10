import { Vibration } from 'react-native';
import * as TaskManager from 'expo-task-manager';

export const ALARM_VIBRATION_TASK = 'ALARM-VIBRATION-TASK';

// Called by the OS when an alarm/test notification is received while the app
// is backgrounded or killed. Vibration is a native module available in the
// headless JS context expo-task-manager uses.
TaskManager.defineTask(ALARM_VIBRATION_TASK, ({ data, error }: any) => {
  if (error || !data) return;
  try {
    const type = data.notification?.request?.content?.data?.type;
    if (type === 'alarm' || type === 'test') {
      Vibration.vibrate([0, 5000]);
    }
  } catch {}
});
