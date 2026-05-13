import { NativeModules, Platform } from 'react-native';

const { FlagSecure } = NativeModules;

export function setFlagSecure(enabled: boolean): void {
  if (Platform.OS !== 'android') return;
  FlagSecure?.setSecure(enabled);
}
