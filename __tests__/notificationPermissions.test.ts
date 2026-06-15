jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone' },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('expo-notifications', () => ({
  __esModule: true,
  AndroidImportance: { HIGH: 'high', MAX: 'max' },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
}));

import {
  getNotificationPermissionStatus,
  requestNotificationPermissions,
} from '../src/notifications/permissions';

const notifications = jest.requireMock('expo-notifications') as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  setNotificationChannelAsync: jest.Mock;
};

describe('notification permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    notifications.setNotificationChannelAsync.mockResolvedValue(undefined);
  });

  it('requests permission again when Android has not granted it yet but can still ask', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: true,
    });
    notifications.requestPermissionsAsync.mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
    });

    await expect(requestNotificationPermissions()).resolves.toBe(true);
    expect(notifications.requestPermissionsAsync).toHaveBeenCalled();
  });

  it('reports blocked when Android has denied permission and can no longer ask again', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    });

    await expect(requestNotificationPermissions()).resolves.toBe(false);
    await expect(getNotificationPermissionStatus()).resolves.toEqual({
      state: 'denied',
      canAskAgain: false,
    });
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
