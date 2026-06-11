jest.mock('react-native', () => require('./renderTestUtils').createReactNativeMock());
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
  },
}));
jest.mock('../src/db/doseLogs', () => ({
  getMissedDosesToday: jest.fn(),
  logDoseTaken: jest.fn(),
  logDoseSkipped: jest.fn(),
  deleteLog: jest.fn(),
  updateLogNote: jest.fn(),
  todayStr: jest.fn(() => '2026-06-11'),
}));
jest.mock('../src/notifications/scheduler', () => ({
  cancelDoseNotifications: jest.fn(),
  rescheduleAll: jest.fn(),
}));
jest.mock('../src/messaging/transport', () => ({
  defaultTransport: { send: jest.fn() },
}));
jest.mock('../src/messaging/secureProtocol', () => ({
  annotateDoseLogProtocolEvent: jest.fn(),
  createDoseEventBatchEnvelope: jest.fn(),
  getNextProtocolEventSeq: jest.fn(),
  getShiftTransportContext: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-1'),
}));

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { DoseCard } from '../src/components/DoseCard';
import { cancelDoseNotifications } from '../src/notifications/scheduler';
import { getMissedDosesToday, logDoseTaken } from '../src/db/doseLogs';
import { findAncestorWithProp, findTextNode, flushEffects } from './renderTestUtils';

describe('DoseCard render behavior', () => {
  const baseDose = {
    key: 'med-1|2026-06-11T08:00:00',
    medication: {
      id: 'med-1',
      entity_id: 'entity-1',
      name: 'Lisinopril',
      dosage: '10 mg',
      pills_per_dose: 1,
      schedule: '{"type":"fixed_times","times":["08:00"]}',
      food_requirement: 'with_food',
      interactions: '[]',
      missed_policy: null,
      early_window_minutes: null,
      missed_window_minutes: null,
      color: '#4A90D9',
      notes: null,
    },
    scheduledAt: '2026-06-11T08:00:00',
    timeLabel: '08:00',
    log: null,
    status: 'due',
    effectiveEarlyWindow: 30,
    effectiveMissedWindow: 60,
    effectiveMissedPolicy: 'none',
    shiftSource: 'local',
    sharedShiftId: null,
    entityPrimaryPhone: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getMissedDosesToday as jest.Mock).mockResolvedValue([]);
    (logDoseTaken as jest.Mock).mockResolvedValue([
      {
        id: 'log-1',
        medication_id: 'med-1',
        scheduled_at: '2026-06-11T08:00:00',
        taken_at: '2026-06-11T08:02:00',
        skipped: 0,
        is_catchup: 0,
        notes: null,
        caregiver_id: null,
        created_at: '2026-06-11T08:02:00',
      },
    ]);
    (cancelDoseNotifications as jest.Mock).mockResolvedValue(undefined);
  });

  it('renders due actions, opens medication details, and logs a take action', async () => {
    const onAction = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <DoseCard dose={baseDose as any} allDoses={[baseDose as any]} onAction={onAction} />,
      );
      await flushEffects();
    });

    expect(findTextNode(tree.root, 'Lisinopril')).toBeTruthy();
    expect(findTextNode(tree.root, 'Take with food')).toBeTruthy();
    expect(findTextNode(tree.root, '✓  Take')).toBeTruthy();
    expect(findTextNode(tree.root, 'Skip')).toBeTruthy();

    await act(async () => {
      findAncestorWithProp(findTextNode(tree.root, 'Lisinopril'), 'onPress').props.onPress();
    });
    expect(router.push).toHaveBeenCalledWith('/entities/entity-1/medications/med-1');

    await act(async () => {
      findAncestorWithProp(findTextNode(tree.root, '✓  Take'), 'onPress').props.onPress();
      await flushEffects();
    });

    expect(logDoseTaken).toHaveBeenCalledWith('med-1', '2026-06-11T08:00:00');
    expect(cancelDoseNotifications).toHaveBeenCalledWith('med-1', '2026-06-11T08:00:00');
    expect(onAction).toHaveBeenCalled();
  });

  it('renders settled state details and opens the long-press note/undo menu', async () => {
    const dose = {
      ...baseDose,
      status: 'taken',
      log: {
        id: 'log-1',
        taken_at: '2026-06-11T08:02:00',
        is_catchup: 0,
        notes: 'Took with breakfast',
      },
    };

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <DoseCard dose={dose as any} allDoses={[dose as any]} onAction={jest.fn()} />,
      );
      await flushEffects();
    });

    expect(findTextNode(tree.root, 'Taken at')).toBeTruthy();
    expect(findTextNode(tree.root, 'Took with breakfast')).toBeTruthy();
    expect(findTextNode(tree.root, 'Hold to add note or undo')).toBeTruthy();

    const outerCard = tree.root.findAllByType('TouchableOpacity' as any)[0];
    await act(async () => {
      outerCard.props.onLongPress();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Dose taken',
      'Lisinopril',
      expect.any(Array),
    );
  });
});
