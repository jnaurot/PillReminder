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
    useLocalSearchParams: jest.fn(),
  };
});
jest.mock('../src/db/doseLogs', () => ({
  getAllDosesForDate: jest.fn(),
  todayStr: jest.fn(() => '2026-06-11'),
}));
jest.mock('../src/db/caregivers', () => ({
  getActiveShift: jest.fn(),
}));
jest.mock('../src/notifications/scheduler', () => ({
  setBadge: jest.fn(),
}));
jest.mock('../src/components/DoseCard', () => ({
  __esModule: true,
  DoseCard: (() => {
    const React = require('react');
    return ({ dose, isDelegated, isHighlighted }: any) => React.createElement(
      'Text',
      {},
      `DoseCard:${dose.medication.name}:delegated=${String(isDelegated)}:highlighted=${String(isHighlighted)}`,
    );
  })(),
}));

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import TodayScreen from '../app/today';
import { useLocalSearchParams } from 'expo-router';
import { getAllDosesForDate } from '../src/db/doseLogs';
import { getActiveShift } from '../src/db/caregivers';
import { setBadge } from '../src/notifications/scheduler';
import { findTextNode, flushEffects } from './renderTestUtils';

describe('Today screen render behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('renders empty state when there are no doses today', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
    (getAllDosesForDate as jest.Mock).mockResolvedValue([]);
    (getActiveShift as jest.Mock).mockResolvedValue(null);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<TodayScreen />);
      await flushEffects();
    });

    expect(findTextNode(tree.root, 'Nothing scheduled today')).toBeTruthy();
    expect(findTextNode(tree.root, 'Manage People')).toBeTruthy();
    expect(setBadge).toHaveBeenCalledWith(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it('renders summary and caregiver banner, then highlights the focused dose card', async () => {
    jest.useFakeTimers();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      medId: 'med-1',
      scheduledAt: '2026-06-11T08:00:00',
      focusToken: 'focus-1',
    });
    (getAllDosesForDate as jest.Mock).mockResolvedValue([
      {
        entityId: 'entity-1',
        entityName: 'Pat Lee',
        doses: [
          {
            key: 'med-1|2026-06-11T08:00:00',
            medication: {
              id: 'med-1',
              entity_id: 'entity-1',
              name: 'Warfarin',
              dosage: '5 mg',
              pills_per_dose: 1,
            },
            scheduledAt: '2026-06-11T08:00:00',
            timeLabel: '08:00',
            log: null,
            status: 'due',
          },
        ],
      },
    ]);
    (getActiveShift as jest.Mock).mockResolvedValue({
      caregiver: { name: 'Robin' },
      end_time: '2026-06-11T16:00:00.000Z',
      entity_ids: '["entity-1"]',
      primary_phone: '',
    });

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<TodayScreen />);
      await flushEffects();
    });

    expect(findTextNode(tree.root, 'Active caregiver: Robin')).toBeTruthy();
    expect(findTextNode(tree.root, '1 needs attention')).toBeTruthy();
    expect(findTextNode(tree.root, 'DoseCard:Warfarin:delegated=true:highlighted=false')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(200);
      await flushEffects();
    });

    expect(findTextNode(tree.root, 'DoseCard:Warfarin:delegated=true:highlighted=true')).toBeTruthy();
    expect(setBadge).toHaveBeenCalledWith(1);
    await act(async () => {
      jest.runOnlyPendingTimers();
      tree.unmount();
    });
  });
});
