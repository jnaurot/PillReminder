import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY_ALIAS = 'pillreminder_db_key_v1';

export async function getOrCreateDbKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(KEY_ALIAS);
  if (stored) return stored;

  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  await SecureStore.setItemAsync(KEY_ALIAS, key);
  return key;
}
