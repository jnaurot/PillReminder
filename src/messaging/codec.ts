import LZString from 'lz-string';
import type { AnyMessage } from './types';

export function encodeMessage(msg: AnyMessage): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(msg));
}

export function decodeMessage(encoded: string): AnyMessage | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    return JSON.parse(json) as AnyMessage;
  } catch {
    return null;
  }
}

export function buildDeepLink(msg: AnyMessage): string {
  return `pillreminder://caregivers/incoming?t=${msg.type}&d=${encodeMessage(msg)}`;
}
