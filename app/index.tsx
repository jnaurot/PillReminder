import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { StatusBar } from 'expo-status-bar';
import { consumePendingNotifRoute, consumePendingDeepLink, notifyAuthSuccess } from './_layout';
import { resolvePostAuthRoute } from '../src/screens/criticalFlows';

function navigateAfterAuth() {
  notifyAuthSuccess();
  const notifRoute = consumePendingNotifRoute();
  const deepLink = consumePendingDeepLink();
  router.replace(resolvePostAuthRoute(deepLink, notifRoute) as any);
}

export default function SplashScreen() {
  const [checking, setChecking] = useState(true);
  const [hasBiometrics, setHasBiometrics] = useState(false);

  useEffect(() => {
    checkBiometrics();
  }, []);

  async function checkBiometrics() {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setHasBiometrics(compatible && enrolled);
    setChecking(false);

    if (compatible && enrolled) {
      authenticate();
    } else {
      navigateAfterAuth();
    }
  }

  async function authenticate() {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Identify to access PillReminder',
      fallbackLabel: 'Use passcode',
      cancelLabel: 'Cancel',
    });

    if (result.success) {
      navigateAfterAuth();
    } else if (result.error === 'user_cancel') {
      // Stay on screen, allow retry
    } else {
      Alert.alert('Authentication failed', 'Please try again.');
    }
  }

  if (checking) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.logoArea}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoEmoji}>💊</Text>
        </View>
        <Text style={styles.appName}>PillReminder</Text>
        <Text style={styles.tagline}>Your medication companion</Text>
      </View>

      {hasBiometrics && (
        <TouchableOpacity style={styles.unlockButton} onPress={authenticate}>
          <Text style={styles.unlockText}>🔒  Tap to unlock</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A2F5A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 60,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#4A90D9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#4A90D9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  logoEmoji: {
    fontSize: 48,
  },
  appName: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: 15,
    color: '#8BA8CC',
    marginTop: 6,
  },
  unlockButton: {
    position: 'absolute',
    bottom: 60,
    paddingHorizontal: 32,
    paddingVertical: 14,
    backgroundColor: 'rgba(74, 144, 217, 0.2)',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#4A90D9',
  },
  unlockText: {
    color: '#4A90D9',
    fontSize: 16,
    fontWeight: '600',
  },
});
