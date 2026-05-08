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
      await scheduleForMedication(med, settings.missed_window_minutes);
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
