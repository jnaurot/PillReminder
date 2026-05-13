import { useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { createMedication } from '../../../../src/db/medications';
import { getSettings } from '../../../../src/db/settings';
import { scheduleForMedication } from '../../../../src/notifications/scheduler';
import { enrichMedication } from '../../../../src/services/rxnorm';
import MedicationForm, { type MedicationFormData } from '../../../../src/components/MedicationForm';

export default function NewMedicationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [saving, setSaving] = useState(false);

  async function handleSave(data: MedicationFormData) {
    setSaving(true);
    try {
      const med = await createMedication({ entity_id: id, ...data });
      const settings = await getSettings();
      const alarm = settings.alarm_enabled
        ? { delayMin: settings.alarm_delay_minutes, type: settings.alarm_type }
        : undefined;
      await scheduleForMedication(med, med.missed_window_minutes ?? settings.missed_window_minutes, alarm);
      router.back();
      enrichMedication(med.id, med.name, id).catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <MedicationForm
      title="New Medication"
      entityId={id}
      saving={saving}
      onSave={handleSave}
    />
  );
}
