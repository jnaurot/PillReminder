import * as SMS from 'expo-sms';
import { buildDeepLink, type TransportPayload } from './codec';

export interface SendOptions {
  phone: string;
  humanText: string; // plain-text fallback for recipients without PillReminder
  msg: TransportPayload;
}

// Swap this interface for a different backend (push, websocket, etc.) without
// touching any caller — just replace defaultTransport.
export interface ITransport {
  send(opts: SendOptions): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export class SmsTransport implements ITransport {
  async isAvailable(): Promise<boolean> {
    return SMS.isAvailableAsync();
  }

  async send({ phone, humanText, msg }: SendOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('SMS not available on this device.');
    }
    const deepLink = buildDeepLink(msg);
    const body = `${humanText}\n\nOpen in PillReminder: ${deepLink}`;
    await SMS.sendSMSAsync([phone], body);
  }
}

export const defaultTransport: ITransport = new SmsTransport();
