import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, Modal, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { getSettings, setSetting, type AppSettings } from '../src/db/settings';
import { getEntities } from '../src/db/entities';
import { exportCSV, exportBackup, importBackup } from '../src/db/backup';
import { rescheduleAll } from '../src/notifications/scheduler';
import {
  getNotificationPermissionStatus,
  requestNotificationPermissions,
  type NotificationPermissionState,
} from '../src/notifications/permissions';
import { setFlagSecure as applyFlagSecure } from '../src/native/flagSecure';
import type { Entity } from '../src/types';

// ─── Password modal ───────────────────────────────────────────────────────────

interface PasswordModalProps {
  visible: boolean;
  mode: 'export' | 'import';
  onConfirm: (password: string) => Promise<void>;
  onCancel: () => void;
}

function PasswordModal({ visible, mode, onConfirm, onCancel }: PasswordModalProps) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<TextInput>(null);

  function reset() { setPw(''); setConfirm(''); setBusy(false); }

  function handleCancel() { reset(); onCancel(); }

  async function handleConfirm() {
    if (!pw.trim()) { Alert.alert('Password required', 'Enter a password for the backup.'); return; }
    if (mode === 'export' && pw !== confirm) { Alert.alert('Passwords do not match', 'Re-enter the same password in both fields.'); return; }
    const value = pw;
    setBusy(true);
    try {
      await onConfirm(value);
      reset();
    } catch (e: any) {
      setBusy(false);
      Alert.alert(mode === 'export' ? 'Export failed' : 'Import failed', e?.message ?? 'Operation failed.');
    }
  }

  const busyLabel = mode === 'export' ? 'Encrypting…' : 'Decrypting…';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={busy ? undefined : handleCancel}>
      <View style={pm.backdrop}>
        <SafeAreaView style={pm.safeTop} edges={['top']}>
        <View style={pm.sheet}>
          <Text style={pm.title}>
            {mode === 'export' ? 'Set Backup Password' : 'Enter Backup Password'}
          </Text>

          {busy ? (
            <View style={pm.busyRow}>
              <ActivityIndicator size="large" color="#4A90D9" />
              <Text style={pm.busyText}>{busyLabel}</Text>
            </View>
          ) : (
            <>
              <Text style={pm.hint}>
                {mode === 'export'
                  ? 'The backup file will be AES-256 encrypted with this password. You will need it to restore.'
                  : 'Enter the password used when this backup was exported.'}
              </Text>

              <Text style={pm.label}>Password</Text>
              <TextInput
                style={pm.input}
                value={pw}
                onChangeText={setPw}
                secureTextEntry
                placeholder="Enter password"
                placeholderTextColor="#94A3B8"
                autoFocus
                returnKeyType={mode === 'export' ? 'next' : 'done'}
                onSubmitEditing={() => mode === 'export' ? confirmRef.current?.focus() : handleConfirm()}
              />

              {mode === 'export' && (
                <>
                  <Text style={pm.label}>Confirm Password</Text>
                  <TextInput
                    ref={confirmRef}
                    style={pm.input}
                    value={confirm}
                    onChangeText={setConfirm}
                    secureTextEntry
                    placeholder="Re-enter password"
                    placeholderTextColor="#94A3B8"
                    returnKeyType="done"
                    onSubmitEditing={handleConfirm}
                  />
                </>
              )}

              <View style={pm.actions}>
                <TouchableOpacity style={pm.cancelBtn} onPress={handleCancel}>
                  <Text style={pm.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={pm.confirmBtn} onPress={handleConfirm}>
                  <Text style={pm.confirmText}>{mode === 'export' ? 'Export' : 'Import'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const pm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-start' },
  safeTop: { backgroundColor: '#FFF', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  sheet: {
    padding: 24, paddingBottom: 28, gap: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#1A2F5A' },
  hint: { fontSize: 13, color: '#64748B' },
  label: { fontSize: 12, fontWeight: '600', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#F8FAFC', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: '#1A2F5A',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 10,
    borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center',
  },
  cancelText: { color: '#64748B', fontWeight: '600' },
  confirmBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 10,
    backgroundColor: '#4A90D9', alignItems: 'center',
  },
  confirmText: { color: '#FFF', fontWeight: '600' },
  busyRow: { alignItems: 'center', paddingVertical: 24, gap: 16 },
  busyText: { fontSize: 15, color: '#64748B', fontWeight: '500' },
});

// ─────────────────────────────────────────────────────────────────────────────

const POLICY_OPTIONS: { value: AppSettings['global_missed_policy']; label: string; desc: string }[] = [
  { value: 'none',      label: 'Flexible',           desc: 'User chooses take or skip freely' },
  { value: 'catch_up',  label: 'Catch-up double dose', desc: 'Missed dose logged automatically when next dose is taken' },
  { value: 'must_skip', label: 'Must skip if missed', desc: 'Missed dose must be skipped before next dose is allowed' },
];

export default function SettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const pendingImportUri = useRef<string | null>(null);
  const [earlyWindow, setEarlyWindow] = useState('30');
  const [missedWindow, setMissedWindow] = useState('60');
  const [policy, setPolicy] = useState<AppSettings['global_missed_policy']>('none');
  const [refillAlertDays, setRefillAlertDays] = useState('7');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [alarmType, setAlarmType] = useState<AppSettings['alarm_type']>('sound,vibration');
  const [inactivityTimeout, setInactivityTimeout] = useState(0);
  const [flagSecure, setFlagSecure] = useState(false);
  const [primaryName, setPrimaryName] = useState('Primary Caregiver');
  const [notificationState, setNotificationState] = useState<NotificationPermissionState>('undetermined');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [exportEntityId, setExportEntityId] = useState<string | null>(null);
  const [showExportScopeModal, setShowExportScopeModal] = useState(false);

  useEffect(() => {
    Promise.all([getSettings(), getNotificationPermissionStatus(), getEntities()])
      .then(([s, permission, loadedEntities]) => {
        setEarlyWindow(String(s.early_window_minutes));
        setMissedWindow(String(s.missed_window_minutes));
        setPolicy(s.global_missed_policy);
        setRefillAlertDays(String(s.refill_alert_days));
        setPrimaryPhone(s.primary_phone);
        setAlarmType(s.alarm_type);
        setInactivityTimeout(s.inactivity_timeout_minutes);
        setFlagSecure(s.flag_secure);
        setPrimaryName(s.primary_name);
        setNotificationState(permission.state);
        setEntities(loadedEntities);
        setLoading(false);
      });
  }, []);

  async function refreshNotificationState() {
    const permission = await getNotificationPermissionStatus();
    setNotificationState(permission.state);
    return permission.state;
  }

  async function handleNotificationAccess() {
    setNotificationBusy(true);
    try {
      const granted = await requestNotificationPermissions();
      const state = await refreshNotificationState();
      if (granted || state === 'granted') {
        await rescheduleAll();
        Alert.alert('Notifications enabled', 'Dose reminders and missed-dose alerts have been re-scheduled.');
        return;
      }

      Alert.alert(
        'Notifications are off',
        'Android is blocking PillReminder notifications. Open system settings and allow notifications for this app.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
        ],
      );
    } finally {
      setNotificationBusy(false);
    }
  }

  async function handleSave() {
    const ew = parseInt(earlyWindow, 10);
    const mw = parseInt(missedWindow, 10);
    const rd = parseInt(refillAlertDays, 10);
    if (isNaN(ew) || ew < 1) { Alert.alert('Early window must be at least 1 minute.'); return; }
    if (isNaN(mw) || mw < 1) { Alert.alert('Missed window must be at least 1 minute.'); return; }
    if (isNaN(rd) || rd < 1) { Alert.alert('Refill alert must be at least 1 day.'); return; }
    setSaving(true);
    await Promise.all([
      setSetting('early_window_minutes', String(ew)),
      setSetting('missed_window_minutes', String(mw)),
      setSetting('global_missed_policy', policy),
      setSetting('refill_alert_days', String(rd)),
      setSetting('primary_phone', primaryPhone.replace(/\D/g, '')),
      setSetting('alarm_type', alarmType || 'sound,vibration'),
      setSetting('inactivity_timeout_minutes', String(inactivityTimeout)),
      setSetting('flag_secure', String(flagSecure)),
      setSetting('primary_name', primaryName.trim() || 'Primary Caregiver'),
    ]);
    await rescheduleAll();
    applyFlagSecure(flagSecure);
    setSaving(false);
    Alert.alert('Saved', 'Default settings updated.');
  }

  async function handleExportCSV() {
    try {
      await exportCSV(exportEntityId);
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not export dose history.');
    }
  }

  const selectedExportEntityName = exportEntityId
    ? (entities.find((entity) => entity.id === exportEntityId)?.name ?? 'All users')
    : 'All users';

  function handleExportBackup() {
    setShowExportModal(true);
  }

  async function handleExportWithPassword(password: string): Promise<void> {
    await exportBackup(password); // throws on failure; modal catches and shows error
    setShowExportModal(false);
  }

  async function handleImportBackup() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      pendingImportUri.current = result.assets[0].uri;
      Alert.alert(
        'Import backup',
        'This will replace ALL existing data with the backup. This cannot be undone. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => setShowImportModal(true) },
        ],
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not open file picker.');
    }
  }

  async function handleImportWithPassword(password: string): Promise<void> {
    const uri = pendingImportUri.current;
    if (!uri) return;
    pendingImportUri.current = null;
    const counts = await importBackup(uri, password); // throws on wrong password or bad file
    await rescheduleAll();
    setShowImportModal(false);
    Alert.alert(
      'Import complete',
      `Restored ${counts.entities} people, ${counts.medications} medications, ${counts.logs} dose logs.`,
    );
  }

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color="#4A90D9" /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}> ‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>App Defaults</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          <Text style={[styles.saveText, saving && styles.saveDisabled]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

        <View style={styles.field}>
          <Text style={styles.label}>Notifications</Text>
          <Text style={styles.hint}>
            Dose reminders and missed-dose alerts depend on Android notification permission.
          </Text>
          <View style={[
            styles.statusCard,
            notificationState === 'granted'
              ? styles.statusCardGood
              : notificationState === 'unavailable'
                ? styles.statusCardNeutral
                : styles.statusCardWarn,
          ]}>
            <Text style={styles.statusTitle}>
              {notificationState === 'granted'
                ? 'Notifications enabled'
                : notificationState === 'unavailable'
                  ? 'Notifications unavailable in Expo Go'
                  : notificationState === 'undetermined'
                    ? 'Notification permission not granted yet'
                    : 'Notifications blocked by Android'}
            </Text>
            <Text style={styles.statusText}>
              {notificationState === 'granted'
                ? 'PillReminder can deliver dose reminders and missed-dose alerts on this device.'
                : notificationState === 'unavailable'
                  ? 'Install the app build on-device to receive notifications.'
                  : notificationState === 'undetermined'
                    ? 'Grant permission so PillReminder can deliver reminders and alarms.'
                    : 'Use Android system settings to re-enable notifications for PillReminder.'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, notificationBusy && styles.actionBtnDisabled]}
            onPress={handleNotificationAccess}
            disabled={notificationBusy || notificationState === 'unavailable'}
          >
            <Text style={styles.actionBtnText}>
              {notificationState === 'granted' ? 'Re-check and re-schedule notifications' : 'Enable notifications'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Auto-Lock</Text>
          <Text style={styles.hint}>
            Lock the app after returning from the background. Requires biometrics to unlock.
          </Text>
          <View style={styles.segRow}>
            {([5, 10, 15, 0] as const).map((val) => (
              <TouchableOpacity
                key={val}
                style={[styles.segBtn, inactivityTimeout === val && styles.segBtnActive]}
                onPress={() => setInactivityTimeout(val)}
              >
                <Text style={[styles.segBtnText, inactivityTimeout === val && styles.segBtnTextActive]}>
                  {val === 0 ? 'Never' : `${val} min`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Screenshot Protection</Text>
          <Text style={styles.hint}>
            Blocks screenshots and hides app preview in the recent-apps switcher.
          </Text>
          <TouchableOpacity
            style={[styles.policyOption, flagSecure && styles.policyOptionActive]}
            onPress={() => setFlagSecure(!flagSecure)}
          >
            <View style={[styles.radioCircle, flagSecure && styles.radioCircleActive]}>
              {flagSecure && <View style={styles.radioDot} />}
            </View>
            <Text style={[styles.policyLabel, flagSecure && styles.policyLabelActive]}>
              {flagSecure ? 'Protection enabled' : 'Protection disabled'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Early Dose Window</Text>
          <Text style={styles.hint}>How many minutes before scheduled time a dose can be taken.</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={earlyWindow}
              onChangeText={setEarlyWindow}
              keyboardType="numeric"
            />
            <View style={styles.unit}><Text style={styles.unitText}>min</Text></View>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Missed Dose Window</Text>
          <Text style={styles.hint}>How many minutes after scheduled time a dose is considered missed.</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={missedWindow}
              onChangeText={setMissedWindow}
              keyboardType="numeric"
            />
            <View style={styles.unit}><Text style={styles.unitText}>min</Text></View>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Refill Alert Threshold</Text>
          <Text style={styles.hint}>Show a warning when this many days of supply remain.</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={refillAlertDays}
              onChangeText={setRefillAlertDays}
              keyboardType="numeric"
            />
            <View style={styles.unit}><Text style={styles.unitText}>days</Text></View>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Missed Dose Alert</Text>
          <Text style={styles.hint}>Choose how the high-priority missed-dose alert should behave after the missed window.</Text>
          <View style={styles.gap8}>
            {([
              ['sound,vibration', 'Sound + Vibration'],
              ['sound', 'Sound'],
              ['vibration', 'Vibration'],
              ['none', 'Silent'],
            ] as const).map(([value, label]) => {
              const active = alarmType === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.policyOption, active && styles.policyOptionActive]}
                  onPress={() => setAlarmType(value)}
                >
                  <View style={[styles.radioCircle, active && styles.radioCircleActive]}>
                    {active && <View style={styles.radioDot} />}
                  </View>
                  <Text style={[styles.policyLabel, active && styles.policyLabelActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>The missed-dose alert fires when the dose reaches its missed window.</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Default Missed Dose Policy</Text>
          <Text style={styles.hint}>Individual medications can override this setting.</Text>
          <View style={styles.gap8}>
            {POLICY_OPTIONS.map(({ value, label, desc }) => (
              <TouchableOpacity
                key={value}
                style={[styles.policyOption, policy === value && styles.policyOptionActive]}
                onPress={() => setPolicy(value)}
              >
                <View style={[styles.radioCircle, policy === value && styles.radioCircleActive]}>
                  {policy === value && <View style={styles.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.policyLabel, policy === value && styles.policyLabelActive]}>{label}</Text>
                  <Text style={styles.policyDesc}>{desc}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>My Information</Text>
          <Text style={styles.hint}>
            Your name appears in dose history to identify who logged each entry.
          </Text>
          <TextInput
            style={styles.input}
            value={primaryName}
            onChangeText={setPrimaryName}
            placeholder="Primary Caregiver"
            placeholderTextColor="#CBD5E1"
          />
          <Text style={[styles.hint, { marginTop: 4 }]}>
            Your number is embedded in caregiver invites so the caregiver's app can send you
            dose updates. Required for full deep-link invites.
          </Text>
          <TextInput
            style={styles.input}
            value={primaryPhone}
            onChangeText={setPrimaryPhone}
            placeholder="+1 555 000 0000"
            placeholderTextColor="#CBD5E1"
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Caregivers</Text>
          <TouchableOpacity style={styles.dataBtn} onPress={() => router.push('/caregivers')}>
            <View style={styles.dataBtnInner}>
              <Text style={styles.dataBtnTitle}>Caregiver Shifts</Text>
              <Text style={styles.dataBtnDesc}>Assign and track active caregivers</Text>
            </View>
            <Text style={styles.dataBtnArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Data</Text>

          <View style={styles.dataRow}>
            <TouchableOpacity style={[styles.dataBtn, styles.dataBtnPrimary]} onPress={handleExportCSV}>
              <View style={styles.dataBtnInner}>
                <Text style={styles.dataBtnTitle}>Export Dose History</Text>
                <Text style={styles.dataBtnDesc}>CSV file — share with a doctor or spreadsheet</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.scopeBtn}
              onPress={() => setShowExportScopeModal(true)}
            >
              <Text style={styles.scopeBtnLabel}>User</Text>
              <Text style={styles.scopeBtnValue} numberOfLines={1}>{selectedExportEntityName}</Text>
              <Text style={styles.scopeBtnChevron}>▼</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.dataBtn} onPress={handleExportBackup}>
            <View style={styles.dataBtnInner}>
              <Text style={styles.dataBtnTitle}>Export Full Backup</Text>
              <Text style={styles.dataBtnDesc}>JSON file — save all data for safekeeping</Text>
            </View>
            <Text style={styles.dataBtnArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.dataBtn, styles.dataBtnDanger]} onPress={handleImportBackup}>
            <View style={styles.dataBtnInner}>
              <Text style={[styles.dataBtnTitle, styles.dataBtnTitleDanger]}>Import Backup</Text>
              <Text style={styles.dataBtnDesc}>Replaces all current data with a backup file</Text>
            </View>
            <Text style={styles.dataBtnArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>v{Constants.expoConfig?.version ?? '—'}</Text>

      </ScrollView>
      </KeyboardAvoidingView>

      <PasswordModal
        visible={showExportModal}
        mode="export"
        onConfirm={handleExportWithPassword}
        onCancel={() => setShowExportModal(false)}
      />
      <PasswordModal
        visible={showImportModal}
        mode="import"
        onConfirm={handleImportWithPassword}
        onCancel={() => setShowImportModal(false)}
      />

      <Modal
        visible={showExportScopeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExportScopeModal(false)}
      >
        <View style={pm.backdrop}>
          <TouchableOpacity
            style={styles.scopeBackdrop}
            activeOpacity={1}
            onPress={() => setShowExportScopeModal(false)}
          />
          <View style={styles.scopeSheet}>
            <Text style={styles.scopeSheetTitle}>Export Dose History</Text>
            <Text style={styles.scopeSheetHint}>Choose which user's dose history to include.</Text>

            <ScrollView style={styles.scopeList} contentContainerStyle={styles.scopeListContent}>
              <TouchableOpacity
                style={[styles.scopeOption, exportEntityId === null && styles.scopeOptionActive]}
                onPress={() => {
                  setExportEntityId(null);
                  setShowExportScopeModal(false);
                }}
              >
                <Text style={[styles.scopeOptionText, exportEntityId === null && styles.scopeOptionTextActive]}>
                  All users
                </Text>
              </TouchableOpacity>

              {entities.map((entity) => {
                const active = exportEntityId === entity.id;
                return (
                  <TouchableOpacity
                    key={entity.id}
                    style={[styles.scopeOption, active && styles.scopeOptionActive]}
                    onPress={() => {
                      setExportEntityId(entity.id);
                      setShowExportScopeModal(false);
                    }}
                  >
                    <Text style={[styles.scopeOptionText, active && styles.scopeOptionTextActive]}>
                      {entity.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.scopeCloseBtn} onPress={() => setShowExportScopeModal(false)}>
              <Text style={styles.scopeCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 10 },
  backText: { fontSize: 16, color: '#4A90D9' },
  title: { fontSize: 17, fontWeight: '600', color: '#1A2F5A' },
  saveText: { fontSize: 16, color: '#4A90D9', fontWeight: '600' },
  saveDisabled: { opacity: 0.4 },
  form: { padding: 20, gap: 24 },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { fontSize: 12, color: '#94A3B8' },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: {
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: '#1A2F5A',
  },
  unit: {
    backgroundColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginLeft: 8,
  },
  unitText: { fontSize: 14, color: '#64748B', fontWeight: '600' },
  gap8: { gap: 8 },
  segRow: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  segBtnActive: { backgroundColor: '#EEF6FF', borderColor: '#4A90D9' },
  segBtnText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  segBtnTextActive: { color: '#4A90D9' },
  policyOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 12,
  },
  policyOptionActive: { borderColor: '#4A90D9', backgroundColor: '#EEF6FF' },
  radioCircle: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#CBD5E1',
    alignItems: 'center', justifyContent: 'center',
  },
  radioCircleActive: { borderColor: '#4A90D9' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4A90D9' },
  policyLabel: { fontSize: 14, fontWeight: '600', color: '#1A2F5A' },
  policyLabelActive: { color: '#4A90D9' },
  policyDesc: { fontSize: 12, color: '#64748B', marginTop: 2 },
  statusCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 4,
    backgroundColor: '#FFFFFF',
  },
  statusCardGood: { borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' },
  statusCardWarn: { borderColor: '#FED7AA', backgroundColor: '#FFF7ED' },
  statusCardNeutral: { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
  statusTitle: { fontSize: 14, fontWeight: '700', color: '#1A2F5A' },
  statusText: { fontSize: 12, color: '#64748B' },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4A90D9',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  dataRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  dataBtnPrimary: { flex: 1 },
  scopeBtn: {
    width: 132,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  scopeBtnLabel: { fontSize: 10, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 },
  scopeBtnValue: { fontSize: 13, fontWeight: '600', color: '#1A2F5A', marginTop: 2 },
  scopeBtnChevron: { fontSize: 11, color: '#94A3B8', marginTop: 6 },
  dataBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 14,
  },
  dataBtnDanger: { borderColor: '#FECACA' },
  dataBtnInner: { flex: 1 },
  dataBtnTitle: { fontSize: 14, fontWeight: '600', color: '#1A2F5A' },
  dataBtnTitleDanger: { color: '#DC2626' },
  dataBtnDesc: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  dataBtnArrow: { fontSize: 20, color: '#CBD5E1', marginLeft: 8 },
  version: { fontSize: 12, color: '#64748B', textAlign: 'center', paddingVertical: 8 },
  scopeBackdrop: { flex: 1 },
  scopeSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 12,
    maxHeight: '70%',
  },
  scopeSheetTitle: { fontSize: 17, fontWeight: '700', color: '#1A2F5A' },
  scopeSheetHint: { fontSize: 12, color: '#64748B' },
  scopeList: { maxHeight: 320 },
  scopeListContent: { gap: 8 },
  scopeOption: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  scopeOptionActive: { borderColor: '#4A90D9', backgroundColor: '#EEF6FF' },
  scopeOptionText: { fontSize: 14, fontWeight: '600', color: '#1A2F5A' },
  scopeOptionTextActive: { color: '#4A90D9' },
  scopeCloseBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 12,
  },
  scopeCloseBtnText: { fontSize: 14, fontWeight: '600', color: '#64748B' },
});
