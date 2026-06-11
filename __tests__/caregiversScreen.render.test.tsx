jest.mock('react-native', () => require('./renderTestUtils').createReactNativeMock());
jest.mock('react-native-safe-area-context', () => require('./renderTestUtils').createSafeAreaContextMock());
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: {
      back: jest.fn(),
      push: jest.fn(),
      replace: jest.fn(),
    },
    useFocusEffect: jest.fn((callback: () => void) => {
      React.useEffect(() => callback(), [callback]);
    }),
  };
});
jest.mock('../src/db/entities', () => ({
  getEntities: jest.fn(),
}));
jest.mock('../src/db/caregivers', () => ({
  getLiveShifts: jest.fn(),
  getRecentShifts: jest.fn(),
  cancelShift: jest.fn(),
  buildInviteSMS: jest.fn(() => 'invite text'),
}));
jest.mock('../src/db/medications', () => ({
  getMedications: jest.fn(),
}));
jest.mock('../src/messaging/transport', () => ({
  defaultTransport: { send: jest.fn() },
}));
jest.mock('../src/messaging/secureProtocol', () => ({
  createShiftCancelEnvelope: jest.fn(),
  createShiftInviteEnvelope: jest.fn(),
  createShiftReturnRequestEnvelope: jest.fn(),
  summarizeOutgoingShiftEvents: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-1'),
}));

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import CaregiversScreen from '../app/caregivers/index';
import { getEntities } from '../src/db/entities';
import { getLiveShifts, getRecentShifts } from '../src/db/caregivers';
import { findTextNode, flushEffects } from './renderTestUtils';

describe('Caregivers screen render behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getEntities as jest.Mock).mockResolvedValue([
      { id: 'entity-1', name: 'Pat Lee' },
      { id: 'entity-2', name: 'Sam Ray' },
    ]);
    (getRecentShifts as jest.Mock).mockResolvedValue([]);
  });

  it('renders the primary-side active banner and pending shift actions', async () => {
    (getLiveShifts as jest.Mock).mockResolvedValue([
      {
        id: 'shift-1',
        caregiver: { name: 'Robin', phone: '5551112222' },
        caregiver_id: 'cg-1',
        entity_ids: '["entity-1"]',
        start_time: '2026-06-11T08:00:00.000Z',
        end_time: '2026-06-11T16:00:00.000Z',
        resolvedStatus: 'pending',
        protocol_state: 'pending',
        confirmation_code: 'ABC123',
        notes: 'Bring water',
        primary_phone: '',
      },
    ]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<CaregiversScreen />);
      await flushEffects();
    });

    expect(findTextNode(tree.root, 'Robin')).toBeTruthy();
    expect(findTextNode(tree.root, 'Pat Lee')).toBeTruthy();
    expect(findTextNode(tree.root, 'Awaiting confirmation')).toBeTruthy();
    expect(findTextNode(tree.root, 'CARE-ABC123')).toBeTruthy();
    expect(findTextNode(tree.root, 'Resend SMS')).toBeTruthy();
    expect(findTextNode(tree.root, 'Cancel')).toBeTruthy();
  });

  it('renders caregiver-side active shift controls when viewing an imported shift', async () => {
    (getLiveShifts as jest.Mock).mockResolvedValue([
      {
        id: 'shift-2',
        caregiver: { name: 'Primary Caregiver', phone: '' },
        caregiver_id: 'cg-2',
        entity_ids: '["*"]',
        start_time: '2026-06-11T08:00:00.000Z',
        end_time: '2026-06-11T16:00:00.000Z',
        resolvedStatus: 'active',
        protocol_state: 'active',
        confirmation_code: 'XYZ789',
        notes: null,
        primary_phone: '5550001111',
      },
    ]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<CaregiversScreen />);
      await flushEffects();
    });

    expect(findTextNode(tree.root, 'Active caregiver: Primary Caregiver')).toBeTruthy();
    expect(findTextNode(tree.root, 'Primary: 5550001111')).toBeTruthy();
    expect(findTextNode(tree.root, 'You are the active caregiver')).toBeTruthy();
    expect(findTextNode(tree.root, 'Active now')).toBeTruthy();
    expect(findTextNode(tree.root, 'End my shift')).toBeTruthy();
  });
});
