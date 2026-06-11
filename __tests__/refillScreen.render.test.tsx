jest.mock('react-native', () => require('./renderTestUtils').createReactNativeMock());
jest.mock('react-native-safe-area-context', () => require('./renderTestUtils').createSafeAreaContextMock());
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: jest.fn(() => ({ id: 'entity-1', medId: 'med-1' })),
}));
jest.mock('../src/db/medications', () => ({
  getMedication: jest.fn(),
}));
jest.mock('../src/db/prescriptions', () => ({
  logRefill: jest.fn(),
  getPrescriptions: jest.fn(),
  deleteRefill: jest.fn(),
}));
jest.mock('../src/db/doseLogs', () => ({
  todayStr: jest.fn(() => '2026-06-11'),
}));
jest.mock('../src/db/settings', () => ({
  getSettings: jest.fn(),
}));
jest.mock('../src/db/database', () => ({
  getDb: jest.fn(),
}));
jest.mock('../src/messaging/transport', () => ({
  defaultTransport: { send: jest.fn() },
}));
jest.mock('../src/messaging/secureProtocol', () => ({
  createRefillEventBatchEnvelope: jest.fn(),
  getNextProtocolEventSeq: jest.fn(),
  getShiftTransportContext: jest.fn(),
  recordOutgoingRefillProtocolEvent: jest.fn(),
}));
jest.mock('../src/components/DateInput', () => {
  const React = require('react');
  return ({ value }: any) => React.createElement('Text', {}, `DateInput:${value}`);
});
jest.mock('../src/notifications/scheduler', () => ({
  cancelRefillAlert: jest.fn(),
  rescheduleAll: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-1'),
}));

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import RefillScreen from '../app/entities/[id]/medications/[medId]/refill';
import { getMedication } from '../src/db/medications';
import { getPrescriptions } from '../src/db/prescriptions';
import { findTextNode, flushEffects } from './renderTestUtils';

describe('Refill screen render behavior', () => {
  const medication = {
    id: 'med-1',
    entity_id: 'entity-1',
    name: 'Metformin',
    dosage: '500 mg',
    pills_per_dose: 2,
    schedule: '{"type":"fixed_times","times":["08:00","20:00"]}',
    food_requirement: null,
    interactions: '[]',
    missed_policy: null,
    early_window_minutes: null,
    missed_window_minutes: null,
    color: '#123456',
    notes: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getMedication as jest.Mock).mockResolvedValue(medication);
  });

  it('renders the starting supply state without a manual days supply field', async () => {
    (getPrescriptions as jest.Mock).mockResolvedValue([]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<RefillScreen />);
      await flushEffects();
    });

    expect(findTextNode(tree.root, 'Supply — Metformin')).toBeTruthy();
    expect(findTextNode(tree.root, 'Starting Supply')).toBeTruthy();
    expect(tree.root.findAll((node) => (node.type as any) === 'Text' && String(node.props.children).includes('Days Supply')).length).toBe(0);
  });

  it('renders refill history and confirms removal on long press', async () => {
    (getPrescriptions as jest.Mock).mockResolvedValue([
      {
        id: 'rx-1',
        refill_date: '2026-06-01',
        quantity: 90,
        unit: 'pills',
      },
    ]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<RefillScreen />);
      await flushEffects();
    });

    expect(findTextNode(tree.root, 'Refill — Metformin')).toBeTruthy();
    expect(findTextNode(tree.root, 'Refill History')).toBeTruthy();
    expect(findTextNode(tree.root, '2026-06-01')).toBeTruthy();
    expect(findTextNode(tree.root, '90 pills')).toBeTruthy();

    const historyRows = tree.root.findAllByType('TouchableOpacity' as any).filter((node) => typeof node.props.onLongPress === 'function');
    await act(async () => {
      historyRows[0].props.onLongPress();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Remove refill entry',
      'Remove the 2026-06-01 refill of 90 pills?',
      expect.any(Array),
    );
  });
});
