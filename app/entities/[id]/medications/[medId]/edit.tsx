import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { getMedication, updateMedication } from '../../../../../src/db/medications';
import { getSettings } from '../../../../../src/db/settings';
import { scheduleForMedication } from '../../../../../src/notifications/scheduler';
import { enrichMedication } from '../../../../../src/services/rxnorm';
import MedicationForm, { type MedicationFormData } from '../../../../../src/components/MedicationForm';
import { parseSchedule, parseInteractions } from '../../../../../src/types';
import type { Medication } from '../../../../../src/types';

export default function EditMedicationScreen() {
  const { id, medId } = useLocalSearchParams<{ id: string; medId: string }>();
  const [medication, setMedication] = useState<Medication | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMedication(medId).then(setMedication);
  }, [medId]);

  async function handleSave(data: MedicationFormData) {
    setSaving(true);
    try {
      await updateMedication(medId, data);
      const updated = await getMedication(medId);
      if (updated) {
        const settings = await getSettings();
        const alarm = settings.alarm_enabled
          ? { delayMin: settings.alarm_delay_minutes, type: settings.alarm_type }
          : undefined;
        await scheduleForMedication(updated, updated.missed_window_minutes ?? settings.missed_window_minutes, alarm);
      }
      router.back();
      enrichMedication(medId, data.name, id).catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  if (!medication) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#4A90D9" />
      </View>
    );
  }

  return (
    <MedicationForm
      title="Edit Medication"
      entityId={id}
      currentMedicationId={medId}
      initialName={medication.name}
      initialDosage={medication.dosage}
      initialPillsPerDose={String(medication.pills_per_dose)}
      initialSchedule={parseSchedule(medication.schedule)}
      initialFoodRequirement={medication.food_requirement as any}
      initialInteractions={parseInteractions(medication.interactions)}
      initialMissedPolicy={medication.missed_policy as any}
      initialEarlyWindowMinutes={medication.early_window_minutes}
      initialMissedWindowMinutes={medication.missed_window_minutes}
      initialColor={medication.color}
      initialNotes={medication.notes ?? ''}
      saving={saving}
      onSave={handleSave}
    />
  );
}
