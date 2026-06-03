import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { MedicationNameInput } from './MedicationNameInput';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMedications } from '../db/medications';
import DateInput from './DateInput';
import type {
  MedicationSchedule, ScheduleType, FoodRequirement,
  MedicationInteraction, MissedPolicy, Medication,
} from '../types';
import { todayStr } from '../utils/dateTime';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#4A90D9', '#E85D5D', '#27AE60', '#F39C12',
  '#8E44AD', '#16A085', '#D35400', '#E91E8C',
];

const PRESET_TIMES = ['06:00', '08:00', '12:00', '14:00', '18:00', '20:00', '22:00'];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SUPPLY_UNITS = ['pills', 'capsules', 'tablets', 'mL', 'mg', 'patches', 'injections', 'puffs', 'drops'];

const SCHEDULE_TYPES: { key: ScheduleType; label: string }[] = [
  { key: 'fixed_times', label: 'Daily' },
  { key: 'prn',         label: 'PRN' },
  { key: 'weekly',      label: 'Weekly' },
  { key: 'monthly',     label: 'Monthly' },
];

// ─── Time picker sub-component ────────────────────────────────────────────────

function TimePicker({
  times,
  onChange,
}: {
  times: string[];
  onChange: (times: string[]) => void;
}) {
  const [customTime, setCustomTime] = useState('');

  function handleCustomTimeChange(text: string) {
    const isDeleting = text.length < customTime.length;
    const digits = text.replace(/\D/g, '').slice(0, 4);
    const prevDigits = customTime.replace(/\D/g, '');

    if (isDeleting) {
      setCustomTime(digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`);
      return;
    }

    if (digits.length === prevDigits.length || digits.length > 4) return;

    const d = parseInt(digits[digits.length - 1]);

    switch (digits.length) {
      case 1:
        // First hour digit > 2 can't be valid as-is; auto-prepend 0
        setCustomTime(d > 2 ? `0${d}:` : `${d}`);
        break;
      case 2: {
        const h1 = parseInt(digits[0]);
        // Second hour digit: if h1 is 2, only 0–3 are valid (20–23)
        if (h1 === 2 && d > 3) return;
        setCustomTime(`${digits}:`);
        break;
      }
      case 3:
        // First minute digit must be 0–5
        if (d > 5) return;
        setCustomTime(`${digits.slice(0, 2)}:${digits[2]}`);
        break;
      case 4:
        setCustomTime(`${digits.slice(0, 2)}:${digits.slice(2)}`);
        break;
    }
  }

  function togglePreset(t: string) {
    onChange(
      times.includes(t) ? times.filter((x) => x !== t) : [...times, t].sort()
    );
  }

  function addCustom() {
    const t = customTime.trim();
    const [h, m] = t.split(':').map(Number);
    if (!/^\d{2}:\d{2}$/.test(t) || h > 23 || m > 59) {
      Alert.alert('Invalid time', 'Enter a valid time as HH:MM (e.g. 07:30)');
      return;
    }
    if (!times.includes(t)) onChange([...times, t].sort());
    setCustomTime('');
  }

  const customTimes = times.filter((t) => !PRESET_TIMES.includes(t));

  return (
    <View style={tp.container}>
      <View style={tp.presetRow}>
        {PRESET_TIMES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[tp.chip, times.includes(t) && tp.chipActive]}
            onPress={() => togglePreset(t)}
          >
            <Text style={[tp.chipText, times.includes(t) && tp.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={tp.customRow}>
        <TextInput
          style={tp.customInput}
          value={customTime}
          onChangeText={handleCustomTimeChange}
          placeholder="HH:MM"
          placeholderTextColor="#94A3B8"
          keyboardType="number-pad"
        />
        <TouchableOpacity style={tp.addBtn} onPress={addCustom}>
          <Text style={tp.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>
      {customTimes.length > 0 && (
        <View style={tp.customTagRow}>
          {customTimes.map((t) => (
            <TouchableOpacity
              key={t}
              style={tp.tag}
              onPress={() => onChange(times.filter((x) => x !== t))}
            >
              <Text style={tp.tagText}>{t} ✕</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const tp = StyleSheet.create({
  container: { gap: 10 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  chipActive: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  chipText: { fontSize: 14, color: '#64748B', fontWeight: '500' },
  chipTextActive: { color: '#FFFFFF' },
  customRow: { flexDirection: 'row', gap: 10 },
  customInput: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#1A2F5A',
  },
  addBtn: {
    backgroundColor: '#4A90D9', borderRadius: 10,
    paddingHorizontal: 18, justifyContent: 'center',
  },
  addBtnText: { color: '#FFF', fontWeight: '600', fontSize: 15 },
  customTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: '#EEF6FF', borderRadius: 16,
    borderWidth: 1, borderColor: '#4A90D9',
  },
  tagText: { fontSize: 13, color: '#4A90D9', fontWeight: '500' },
});

// ─── Schedule sections ────────────────────────────────────────────────────────

function FixedTimesSection({
  schedule,
  onChange,
}: {
  schedule: { times: string[] };
  onChange: (s: { times: string[] }) => void;
}) {
  return (
    <TimePicker
      times={schedule.times}
      onChange={(times) => onChange({ times })}
    />
  );
}

function PrnSection({
  schedule,
  onChange,
}: {
  schedule: { max_doses_per_day: number | null; min_interval_hours: number | null };
  onChange: (s: typeof schedule) => void;
}) {
  return (
    <View style={s.gap12}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.subLabel}>Max doses per day</Text>
          <TextInput
            style={s.smallInput}
            value={schedule.max_doses_per_day?.toString() ?? ''}
            onChangeText={(v) =>
              onChange({ ...schedule, max_doses_per_day: v ? parseInt(v, 10) : null })
            }
            placeholder="No limit"
            placeholderTextColor="#94A3B8"
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.subLabel}>Min hours between doses</Text>
          <TextInput
            style={s.smallInput}
            value={schedule.min_interval_hours?.toString() ?? ''}
            onChangeText={(v) =>
              onChange({ ...schedule, min_interval_hours: v ? parseFloat(v) : null })
            }
            placeholder="No minimum"
            placeholderTextColor="#94A3B8"
            keyboardType="numeric"
          />
        </View>
      </View>
      <Text style={s.hint}>Leave either field blank for no restriction.</Text>
    </View>
  );
}

function WeeklySection({
  schedule,
  onChange,
}: {
  schedule: { days: number[]; times: string[] };
  onChange: (s: typeof schedule) => void;
}) {
  function toggleDay(d: number) {
    const days = schedule.days.includes(d)
      ? schedule.days.filter((x) => x !== d)
      : [...schedule.days, d].sort((a, b) => a - b);
    onChange({ ...schedule, days });
  }

  return (
    <View style={s.gap12}>
      <Text style={s.subLabel}>Days of week</Text>
      <View style={s.dayRow}>
        {DAY_LABELS.map((label, i) => (
          <TouchableOpacity
            key={i}
            style={[s.dayChip, schedule.days.includes(i) && s.dayChipActive]}
            onPress={() => toggleDay(i)}
          >
            <Text style={[s.dayChipText, schedule.days.includes(i) && s.dayChipTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.subLabel}>Times on selected days</Text>
      <TimePicker
        times={schedule.times}
        onChange={(times) => onChange({ ...schedule, times })}
      />
    </View>
  );
}

function MonthlySection({
  schedule,
  onChange,
}: {
  schedule: { days: number[]; times: string[] };
  onChange: (s: typeof schedule) => void;
}) {
  function toggleDay(d: number) {
    const days = schedule.days.includes(d)
      ? schedule.days.filter((x) => x !== d)
      : [...schedule.days, d].sort((a, b) => a - b);
    onChange({ ...schedule, days });
  }

  return (
    <View style={s.gap12}>
      <Text style={s.subLabel}>Days of month</Text>
      <View style={s.monthGrid}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <TouchableOpacity
            key={d}
            style={[s.dayNumChip, schedule.days.includes(d) && s.dayNumChipActive]}
            onPress={() => toggleDay(d)}
          >
            <Text style={[s.dayNumText, schedule.days.includes(d) && s.dayNumTextActive]}>
              {d}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.subLabel}>Times on selected days</Text>
      <TimePicker
        times={schedule.times}
        onChange={(times) => onChange({ ...schedule, times })}
      />
    </View>
  );
}

// ─── Interaction picker modal ─────────────────────────────────────────────────

function InteractionModal({
  visible,
  siblings,
  onAdd,
  onClose,
}: {
  visible: boolean;
  siblings: Medication[];
  onAdd: (interaction: MedicationInteraction) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interactionType, setInteractionType] = useState<'with' | 'hours_after'>('with');
  const [hours, setHours] = useState('');

  function handleAdd() {
    const med = siblings.find((m) => m.id === selectedId);
    if (!med) { Alert.alert('Select a medication first.'); return; }
    if (interactionType === 'hours_after') {
      const h = parseFloat(hours);
      if (isNaN(h) || h <= 0) { Alert.alert('Enter valid hours.'); return; }
      onAdd({ type: 'hours_after', medication_id: med.id, medication_name: med.name, hours: h });
    } else {
      onAdd({ type: 'with', medication_id: med.id, medication_name: med.name });
    }
    setSelectedId(null);
    setHours('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={m.backdrop}>
        <View style={m.sheet}>
          <Text style={m.title}>Add Interaction</Text>

          <Text style={m.label}>Medication</Text>
          {siblings.length === 0 ? (
            <Text style={m.empty}>No other medications for this person yet.</Text>
          ) : (
            siblings.map((med) => (
              <TouchableOpacity
                key={med.id}
                style={[m.option, selectedId === med.id && m.optionActive]}
                onPress={() => setSelectedId(med.id)}
              >
                <View style={[m.colorDot, { backgroundColor: med.color }]} />
                <Text style={m.optionText}>{med.name}</Text>
              </TouchableOpacity>
            ))
          )}

          <Text style={[m.label, { marginTop: 16 }]}>Type</Text>
          <View style={m.typeRow}>
            {(['with', 'hours_after'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[m.typeChip, interactionType === t && m.typeChipActive]}
                onPress={() => setInteractionType(t)}
              >
                <Text style={[m.typeChipText, interactionType === t && m.typeChipTextActive]}>
                  {t === 'with' ? 'Take together' : 'Hours after'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {interactionType === 'hours_after' && (
            <TextInput
              style={m.hoursInput}
              value={hours}
              onChangeText={setHours}
              placeholder="Hours (e.g. 4)"
              placeholderTextColor="#94A3B8"
              keyboardType="numeric"
            />
          )}

          <View style={m.actions}>
            <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
              <Text style={m.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={m.addBtn} onPress={handleAdd}>
              <Text style={m.addText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const m = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 36,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#1A2F5A', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  empty: { color: '#94A3B8', fontSize: 14, marginBottom: 8 },
  option: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0',
    marginBottom: 6, backgroundColor: '#F8FAFC',
  },
  optionActive: { borderColor: '#4A90D9', backgroundColor: '#EEF6FF' },
  colorDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  optionText: { fontSize: 15, color: '#1A2F5A' },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  typeChip: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#CBD5E1',
    alignItems: 'center', backgroundColor: '#F8FAFC',
  },
  typeChipActive: { borderColor: '#4A90D9', backgroundColor: '#EEF6FF' },
  typeChipText: { fontSize: 14, color: '#64748B', fontWeight: '500' },
  typeChipTextActive: { color: '#4A90D9', fontWeight: '600' },
  hoursInput: {
    backgroundColor: '#F8FAFC', borderRadius: 8,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: '#1A2F5A', marginBottom: 8,
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center',
  },
  cancelText: { color: '#64748B', fontWeight: '600' },
  addBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#4A90D9', alignItems: 'center',
  },
  addText: { color: '#FFF', fontWeight: '600' },
});

// ─── Main form ────────────────────────────────────────────────────────────────

export interface MedicationFormData {
  name: string;
  dosage: string;
  pills_per_dose: number;
  schedule: string;             // JSON
  food_requirement: string | null;
  interactions: string;         // JSON
  missed_policy: string | null; // 'none' | 'catch_up' | 'must_skip' | null
  early_window_minutes: number | null;
  missed_window_minutes: number | null;
  color: string;
  notes: string | null;
  starting_supply_quantity: number | null;
  starting_supply_unit: string;
  starting_supply_date: string | null;
}

interface Props {
  title: string;
  entityId: string;
  initialName?: string;
  initialDosage?: string;
  initialPillsPerDose?: string;
  initialSchedule?: MedicationSchedule;
  initialFoodRequirement?: FoodRequirement;
  initialInteractions?: MedicationInteraction[];
  initialMissedPolicy?: MissedPolicy;
  initialEarlyWindowMinutes?: number | null;
  initialMissedWindowMinutes?: number | null;
  initialColor?: string;
  initialNotes?: string;
  initialStartingSupplyQuantity?: string;
  initialStartingSupplyUnit?: string;
  initialStartingSupplyDate?: string;
  currentMedicationId?: string;
  saving: boolean;
  onSave: (data: MedicationFormData) => void;
}

export default function MedicationForm({
  title,
  entityId,
  initialName = '',
  initialDosage = '',
  initialPillsPerDose = '1',
  initialSchedule = { type: 'fixed_times', times: [] },
  initialFoodRequirement = null,
  initialInteractions = [],
  initialMissedPolicy = null,
  initialEarlyWindowMinutes = null,
  initialMissedWindowMinutes = null,
  initialColor = '#4A90D9',
  initialNotes = '',
  initialStartingSupplyQuantity = '',
  initialStartingSupplyUnit = 'pills',
  initialStartingSupplyDate = todayStr(),
  currentMedicationId,
  saving,
  onSave,
}: Props) {
  const [name, setName] = useState(initialName);
  const [dosage, setDosage] = useState(initialDosage);
  const [pillsPerDose, setPillsPerDose] = useState(initialPillsPerDose);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initialSchedule.type);
  const [fixedTimes, setFixedTimes] = useState<string[]>(
    initialSchedule.type === 'fixed_times' ? initialSchedule.times : []
  );
  const [prnConfig, setPrnConfig] = useState({
    max_doses_per_day: initialSchedule.type === 'prn' ? initialSchedule.max_doses_per_day : null,
    min_interval_hours: initialSchedule.type === 'prn' ? initialSchedule.min_interval_hours : null,
  });
  const [weeklyConfig, setWeeklyConfig] = useState({
    days: initialSchedule.type === 'weekly' ? initialSchedule.days : [],
    times: initialSchedule.type === 'weekly' ? initialSchedule.times : [],
  });
  const [monthlyConfig, setMonthlyConfig] = useState({
    days: initialSchedule.type === 'monthly' ? initialSchedule.days : [],
    times: initialSchedule.type === 'monthly' ? initialSchedule.times : [],
  });
  const [foodReq, setFoodReq] = useState<FoodRequirement>(initialFoodRequirement);
  const [interactions, setInteractions] = useState<MedicationInteraction[]>(initialInteractions);
  const [missedPolicy, setMissedPolicy] = useState<MissedPolicy>(initialMissedPolicy);
  const [earlyWindowOverride, setEarlyWindowOverride] = useState<string>(
    initialEarlyWindowMinutes !== null ? String(initialEarlyWindowMinutes) : ''
  );
  const [missedWindowOverride, setMissedWindowOverride] = useState<string>(
    initialMissedWindowMinutes !== null ? String(initialMissedWindowMinutes) : ''
  );
  const [color, setColor] = useState(initialColor);
  const [notes, setNotes] = useState(initialNotes);
  const [startingSupplyQuantity, setStartingSupplyQuantity] = useState(initialStartingSupplyQuantity);
  const [startingSupplyUnit, setStartingSupplyUnit] = useState(initialStartingSupplyUnit);
  const [startingSupplyDate, setStartingSupplyDate] = useState(initialStartingSupplyDate);
  const [siblings, setSiblings] = useState<Medication[]>([]);
  const [showInteractionModal, setShowInteractionModal] = useState(false);
  const showStartingSupply = !currentMedicationId;

  useEffect(() => {
    getMedications(entityId).then((meds) =>
      setSiblings(meds.filter((m) => m.id !== currentMedicationId))
    );
  }, [entityId, currentMedicationId]);

  function buildSchedule(): MedicationSchedule {
    switch (scheduleType) {
      case 'fixed_times': return { type: 'fixed_times', times: fixedTimes };
      case 'prn':         return { type: 'prn', ...prnConfig };
      case 'weekly':      return { type: 'weekly', ...weeklyConfig };
      case 'monthly':     return { type: 'monthly', ...monthlyConfig };
    }
  }

  function validateSchedule(): string | null {
    switch (scheduleType) {
      case 'fixed_times':
        return fixedTimes.length === 0 ? 'Add at least one dose time.' : null;
      case 'prn':
        return null; // both fields optional
      case 'weekly':
        if (weeklyConfig.days.length === 0) return 'Select at least one day.';
        if (weeklyConfig.times.length === 0) return 'Add at least one time.';
        return null;
      case 'monthly':
        if (monthlyConfig.days.length === 0) return 'Select at least one day of the month.';
        if (monthlyConfig.times.length === 0) return 'Add at least one time.';
        return null;
    }
  }

  function handleSave() {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    if (!dosage.trim()) { Alert.alert('Dosage required'); return; }
    const pills = parseInt(pillsPerDose, 10);
    if (isNaN(pills) || pills < 1) { Alert.alert('Pills per dose must be at least 1'); return; }
    const scheduleError = validateSchedule();
    if (scheduleError) { Alert.alert('Schedule incomplete', scheduleError); return; }

    const earlyWindow = earlyWindowOverride.trim()
      ? parseInt(earlyWindowOverride, 10)
      : null;
    const missedWindow = missedWindowOverride.trim()
      ? parseInt(missedWindowOverride, 10)
      : null;
    const startingSupply = startingSupplyQuantity.trim()
      ? parseInt(startingSupplyQuantity, 10)
      : null;

    if (startingSupplyQuantity.trim()) {
      if (isNaN(startingSupply!) || startingSupply! < 1) {
        Alert.alert('Starting supply must be a positive number');
        return;
      }
      if (!startingSupplyDate || !/^\d{4}-\d{2}-\d{2}$/.test(startingSupplyDate)) {
        Alert.alert('Enter a valid starting supply date.');
        return;
      }
    }

    onSave({
      name: name.trim(),
      dosage: dosage.trim(),
      pills_per_dose: pills,
      schedule: JSON.stringify(buildSchedule()),
      food_requirement: foodReq,
      interactions: JSON.stringify(interactions),
      missed_policy: missedPolicy,
      early_window_minutes: isNaN(earlyWindow!) ? null : earlyWindow,
      missed_window_minutes: isNaN(missedWindow!) ? null : missedWindow,
      color,
      notes: notes.trim() || null,
      starting_supply_quantity: startingSupply && !isNaN(startingSupply) ? startingSupply : null,
      starting_supply_unit: startingSupplyUnit,
      starting_supply_date: startingSupply && !isNaN(startingSupply) ? startingSupplyDate : null,
    });
  }

  function removeInteraction(index: number) {
    setInteractions((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backText}> ‹ Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>{title}</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            <Text style={[s.saveText, saving && s.saveDisabled]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">

          {/* Name */}
          <View style={[s.field, { zIndex: 10 }]}>
            <Text style={s.label}>Medication Name *</Text>
            <MedicationNameInput
              inputStyle={s.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Metformin"
              placeholderTextColor="#94A3B8"
              autoFocus
            />
          </View>

          {/* Dosage */}
          <View style={s.field}>
            <Text style={s.label}>Dosage *</Text>
            <TextInput style={s.input} value={dosage} onChangeText={setDosage}
              placeholder="e.g. 500mg" placeholderTextColor="#94A3B8" />
          </View>

          {/* Pills per dose */}
          <View style={s.field}>
            <Text style={s.label}>Pills per Dose *</Text>
            <View style={s.counterRow}>
              <TouchableOpacity style={s.counterBtn}
                onPress={() => setPillsPerDose((v) => String(Math.max(1, parseInt(v, 10) - 1)))}>
                <Text style={s.counterBtnText}>−</Text>
              </TouchableOpacity>
              <TextInput style={s.counterInput} value={pillsPerDose}
                onChangeText={setPillsPerDose} keyboardType="numeric" textAlign="center" />
              <TouchableOpacity style={s.counterBtn}
                onPress={() => setPillsPerDose((v) => String(parseInt(v, 10) + 1))}>
                <Text style={s.counterBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Schedule type selector */}
          <View style={s.field}>
            <Text style={s.label}>Schedule *</Text>
            <View style={s.segmentRow}>
              {SCHEDULE_TYPES.map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[s.segment, scheduleType === key && s.segmentActive]}
                  onPress={() => setScheduleType(key)}
                >
                  <Text style={[s.segmentText, scheduleType === key && s.segmentTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.scheduleBody}>
              {scheduleType === 'fixed_times' && (
                <FixedTimesSection
                  schedule={{ times: fixedTimes }}
                  onChange={({ times }) => setFixedTimes(times)}
                />
              )}
              {scheduleType === 'prn' && (
                <PrnSection schedule={prnConfig} onChange={setPrnConfig} />
              )}
              {scheduleType === 'weekly' && (
                <WeeklySection schedule={weeklyConfig} onChange={setWeeklyConfig} />
              )}
              {scheduleType === 'monthly' && (
                <MonthlySection schedule={monthlyConfig} onChange={setMonthlyConfig} />
              )}
            </View>
          </View>

          {/* Food requirement */}
          <View style={s.field}>
            <Text style={s.label}>Food</Text>
            <View style={s.foodRow}>
              {([null, 'with_food', 'without_food'] as FoodRequirement[]).map((v) => (
                <TouchableOpacity
                  key={String(v)}
                  style={[s.foodChip, foodReq === v && s.foodChipActive]}
                  onPress={() => setFoodReq(v)}
                >
                  <Text style={[s.foodChipText, foodReq === v && s.foodChipTextActive]}>
                    {v === null ? 'No preference' : v === 'with_food' ? '🍽 With food' : '🚫 Without food'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Interactions */}
          <View style={s.field}>
            <View style={s.fieldHeaderRow}>
              <Text style={s.label}>Interactions</Text>
              <TouchableOpacity
                style={s.smallAddBtn}
                onPress={() => setShowInteractionModal(true)}
              >
                <Text style={s.smallAddBtnText}>+ Add</Text>
              </TouchableOpacity>
            </View>
            {interactions.length === 0 ? (
              <Text style={s.emptyHint}>None set — tap Add to enforce co-administration or timing rules.</Text>
            ) : (
              interactions.map((ix, i) => (
                <View key={i} style={s.interactionCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.interactionMed}>{ix.medication_name}</Text>
                    <Text style={s.interactionDesc}>
                      {ix.type === 'with'
                        ? 'Must be taken together'
                        : `Must be taken ${ix.hours}h after`}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => removeInteraction(i)}>
                    <Text style={s.removeText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          {/* Missed dose policy */}
          <View style={s.field}>
            <Text style={s.label}>Missed Dose Policy</Text>
            <Text style={s.hint}>Overrides app default. "Flexible" uses the global setting.</Text>
            <View style={s.gap8}>
              {([
                { value: null,        label: 'Flexible (global)',        desc: 'User chooses take or skip freely' },
                { value: 'catch_up',  label: 'Catch-up double dose',     desc: 'Missed dose logged automatically when next dose is taken' },
                { value: 'must_skip', label: 'Must skip if missed',      desc: 'Missed dose must be skipped before next dose is allowed' },
              ] as { value: MissedPolicy; label: string; desc: string }[]).map(({ value, label, desc }) => (
                <TouchableOpacity
                  key={String(value)}
                  style={[s.policyOption, missedPolicy === value && s.policyOptionActive]}
                  onPress={() => setMissedPolicy(value)}
                >
                  <View style={[s.radioCircle, missedPolicy === value && s.radioCircleActive]}>
                    {missedPolicy === value && <View style={s.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.policyLabel, missedPolicy === value && s.policyLabelActive]}>
                      {label}
                    </Text>
                    <Text style={s.policyDesc}>{desc}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Early window override */}
          <View style={s.field}>
            <Text style={s.label}>Early Dose Window</Text>
            <Text style={s.hint}>Minutes before scheduled time a dose can be taken. Leave blank to use app default.</Text>
            <View style={s.row}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={earlyWindowOverride}
                onChangeText={setEarlyWindowOverride}
                placeholder="Use app default"
                placeholderTextColor="#94A3B8"
                keyboardType="numeric"
              />
              <View style={s.windowUnit}>
                <Text style={s.windowUnitText}>min</Text>
              </View>
            </View>
          </View>

          {/* Missed window override */}
          <View style={s.field}>
            <Text style={s.label}>Missed Dose Window</Text>
            <Text style={s.hint}>Minutes after scheduled time before a dose is marked missed. Leave blank to use app default.</Text>
            <View style={s.row}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={missedWindowOverride}
                onChangeText={setMissedWindowOverride}
                placeholder="Use app default"
                placeholderTextColor="#94A3B8"
                keyboardType="numeric"
              />
              <View style={s.windowUnit}>
                <Text style={s.windowUnitText}>min</Text>
              </View>
            </View>
          </View>

          {/* Color */}
          <View style={s.field}>
            <Text style={s.label}>Color</Text>
            <View style={s.colorRow}>
              {PRESET_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.colorSwatch, { backgroundColor: c }, color === c && s.colorSwatchSelected]}
                  onPress={() => setColor(c)}
                />
              ))}
            </View>
          </View>

          {/* Notes */}
          <View style={s.field}>
            <Text style={s.label}>Notes</Text>
            <TextInput
              style={[s.input, s.multiline]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Instructions, special notes…"
              placeholderTextColor="#94A3B8"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {showStartingSupply && (
            <View style={s.field}>
              <Text style={s.label}>Starting Supply</Text>
              <Text style={s.hint}>Optional. Leave blank to keep refill tracking in an unknown state until you log supply later.</Text>
              <View style={s.row}>
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  value={startingSupplyQuantity}
                  onChangeText={setStartingSupplyQuantity}
                  placeholder="e.g. 30"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                />
                <View style={s.inlineUnitWrap}>
                  <Text style={s.subLabel}>Unit</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    <View style={s.unitChipRow}>
                      {SUPPLY_UNITS.map((unit) => (
                        <TouchableOpacity
                          key={unit}
                          style={[s.unitChip, startingSupplyUnit === unit && s.unitChipActive]}
                          onPress={() => setStartingSupplyUnit(unit)}
                        >
                          <Text style={[s.unitChipText, startingSupplyUnit === unit && s.unitChipTextActive]}>
                            {unit}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>
              <View style={s.gap8}>
                <Text style={s.subLabel}>Start Date</Text>
                <DateInput value={startingSupplyDate} onChange={setStartingSupplyDate} style={s.input} />
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <InteractionModal
        visible={showInteractionModal}
        siblings={siblings}
        onAdd={(ix) => setInteractions((prev) => [...prev, ix])}
        onClose={() => setShowInteractionModal(false)}
      />
    </SafeAreaView>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
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
  form: { padding: 20, gap: 24, paddingBottom: 48 },
  field: { gap: 8 },
  fieldHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  subLabel: { fontSize: 12, fontWeight: '600', color: '#64748B', marginBottom: 4 },
  input: {
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: '#1A2F5A',
  },
  multiline: { height: 90, paddingTop: 12 },
  smallInput: {
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#1A2F5A',
  },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  counterBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#4A90D9', alignItems: 'center', justifyContent: 'center',
  },
  counterBtnText: { color: '#FFF', fontSize: 22, lineHeight: 26 },
  counterInput: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    paddingVertical: 10, fontSize: 18, color: '#1A2F5A', fontWeight: '600',
  },
  segmentRow: {
    flexDirection: 'row', backgroundColor: '#E2E8F0',
    borderRadius: 10, padding: 3,
  },
  segment: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
  },
  segmentActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  segmentText: { fontSize: 13, fontWeight: '500', color: '#64748B' },
  segmentTextActive: { color: '#1A2F5A', fontWeight: '700' },
  scheduleBody: {
    backgroundColor: '#FFFFFF', borderRadius: 12,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 14, marginTop: 4,
  },
  foodRow: { gap: 8 },
  foodChip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  foodChipActive: { borderColor: '#4A90D9', backgroundColor: '#EEF6FF' },
  foodChipText: { fontSize: 14, color: '#64748B' },
  foodChipTextActive: { color: '#4A90D9', fontWeight: '600' },
  smallAddBtn: {
    backgroundColor: '#4A90D9', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14,
  },
  smallAddBtnText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  emptyHint: { fontSize: 13, color: '#94A3B8', fontStyle: 'italic' },
  interactionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 12,
  },
  interactionMed: { fontSize: 14, fontWeight: '600', color: '#1A2F5A' },
  interactionDesc: { fontSize: 12, color: '#64748B', marginTop: 2 },
  removeText: { fontSize: 16, color: '#E85D5D', paddingLeft: 12 },
  colorRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  colorSwatch: { width: 36, height: 36, borderRadius: 18 },
  colorSwatchSelected: { borderWidth: 3, borderColor: '#1A2F5A', transform: [{ scale: 1.15 }] },
  row: { flexDirection: 'row' },
  gap12: { gap: 12 },
  hint: { fontSize: 12, color: '#94A3B8', fontStyle: 'italic' },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  dayChip: {
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 18, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF',
  },
  dayChipActive: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  dayChipText: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  dayChipTextActive: { color: '#FFF' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dayNumChip: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF',
  },
  dayNumChipActive: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  dayNumText: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  dayNumTextActive: { color: '#FFF' },
  gap8: { gap: 8 },
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
  windowUnit: {
    backgroundColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: 14, justifyContent: 'center', marginLeft: 8,
  },
  windowUnitText: { fontSize: 14, color: '#64748B', fontWeight: '600' },
  inlineUnitWrap: { flex: 1, marginLeft: 8, gap: 4 },
  unitChipRow: { flexDirection: 'row', gap: 8 },
  unitChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  unitChipActive: { backgroundColor: '#4A90D9', borderColor: '#4A90D9' },
  unitChipText: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  unitChipTextActive: { color: '#FFFFFF' },
});
