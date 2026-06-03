import LZString from 'lz-string';
import type { AnyMessage } from './types';
import type { ProtocolEnvelope } from './protocol';

export type TransportPayload = AnyMessage | ProtocolEnvelope;

function isProtocolEnvelope(payload: unknown): payload is ProtocolEnvelope {
  return !!payload
    && typeof payload === 'object'
    && 'protocol_version' in payload
    && 'message_type' in payload;
}

export function encodeMessage(msg: TransportPayload): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(msg));
}

export function decodeMessage(encoded: string): TransportPayload | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json) as TransportPayload;
    if (isProtocolEnvelope(parsed)) return parsed;
    return parsed as AnyMessage;
  } catch {
    return null;
  }
}

export function buildDeepLink(msg: TransportPayload): string {
  const type = isProtocolEnvelope(msg) ? msg.message_type : msg.type;
  return `pillreminder://caregivers/incoming?t=${type}&d=${encodeMessage(msg)}`;
}

export { isProtocolEnvelope };
