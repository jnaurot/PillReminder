import { useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { createMedication } from '../../../../src/db/medications';
import { logRefill } from '../../../../src/db/prescriptions';
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
      const {
        starting_supply_quantity,
        starting_supply_unit,
        starting_supply_date,
        ...medicationData
      } = data;
      const med = await createMedication({ entity_id: id, ...medicationData });
      if (starting_supply_quantity !== null) {
        await logRefill(
          med.id,
          starting_supply_quantity,
          null,
          starting_supply_date ?? undefined,
          starting_supply_unit,
        );
      }
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
