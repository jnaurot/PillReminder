import type { ShiftWithCaregiver } from '../db/caregivers';
import type { EntityDoses, ScheduledDose } from '../db/doseLogs';
import type { Medication, Entity } from '../types';
import { parseSchedule } from '../types';

export function computeSuggestedDays(med: Medication, quantityStr: string): number | null {
  const qty = parseInt(quantityStr, 10);
  if (Number.isNaN(qty) || qty < 1) return null;

  const schedule = parseSchedule(med.schedule);
  let dosesPerDay: number;
  switch (schedule.type) {
    case 'fixed_times':
      dosesPerDay = schedule.times.length;
      break;
    case 'weekly':
      dosesPerDay = (schedule.days.length * schedule.times.length) / 7;
      break;
    case 'monthly':
      dosesPerDay = (schedule.days.length * schedule.times.length) / 30;
      break;
    default:
      return null;
  }

  if (dosesPerDay <= 0) return null;
  return Math.round(qty / (med.pills_per_dose * dosesPerDay));
}

export function shouldOfferPrimaryRefillUpdate(entityRow: {
  shift_source: string;
  shared_shift_id: string | null;
  primary_phone: string | null;
} | null | undefined): entityRow is {
  shift_source: 'shared';
  shared_shift_id: string;
  primary_phone: string;
} {
  return entityRow?.shift_source === 'shared' &&
    typeof entityRow.primary_phone === 'string' &&
    entityRow.primary_phone.length > 0 &&
    typeof entityRow.shared_shift_id === 'string' &&
    entityRow.shared_shift_id.length > 0;
}

export function buildRefillHumanText(
  medicationName: string,
  quantity: number,
  unit: string,
  daysSupply: number | null,
): string {
  return `Refill logged: ${medicationName} — ${quantity} ${unit}${daysSupply ? `, ${daysSupply}d supply` : ''}.`;
}

export function buildDelegatedEntityIds(
  shift: Pick<ShiftWithCaregiver, 'entity_ids'> | null,
  all: Array<Pick<EntityDoses, 'entityId'>>,
): Set<string> {
  if (!shift) return new Set();
  try {
    const ids: string[] = JSON.parse(shift.entity_ids);
    return ids.includes('*') ? new Set(all.map((entity) => entity.entityId)) : new Set(ids);
  } catch {
    return new Set();
  }
}

export function locateDoseFocus(
  sections: Array<{ data: ScheduledDose[] }>,
  focusTarget: { medId: string; scheduledAt: string | null },
): { sectionIndex: number; itemIndex: number; key: string } | null {
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const items = sections[sectionIndex].data;
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      const medMatches = item.medication.id === focusTarget.medId;
      const scheduledMatches = !focusTarget.scheduledAt || item.scheduledAt === focusTarget.scheduledAt;
      if (medMatches && scheduledMatches) {
        return { sectionIndex, itemIndex, key: item.key };
      }
    }
  }
  return null;
}

export function summarizeTodaySections(sections: Array<{ doses: ScheduledDose[] }>): {
  allDoses: ScheduledDose[];
  actionableCount: number;
  settledCount: number;
} {
  const allDoses = sections.flatMap((section) => section.doses);
  const actionableCount = allDoses.filter((dose) => dose.status === 'due' || dose.status === 'missed').length;
  const settledCount = allDoses.filter((dose) => dose.status === 'taken' || dose.status === 'skipped').length;
  return { allDoses, actionableCount, settledCount };
}

export function getShiftEntityNames(
  shift: Pick<ShiftWithCaregiver, 'entity_ids'>,
  entities: Array<Pick<Entity, 'id' | 'name'>>,
): string[] {
  try {
    const ids: string[] = JSON.parse(shift.entity_ids);
    if (ids.includes('*') || ids.length === 0) return entities.map((entity) => entity.name);
    return entities.filter((entity) => ids.includes(entity.id)).map((entity) => entity.name);
  } catch {
    return entities.map((entity) => entity.name);
  }
}

export function getShiftEntityIds(
  shift: Pick<ShiftWithCaregiver, 'entity_ids'>,
  entities: Array<Pick<Entity, 'id'>>,
): string[] {
  try {
    const ids: string[] = JSON.parse(shift.entity_ids);
    if (ids.includes('*') || ids.length === 0) return entities.map((entity) => entity.id);
    return entities.filter((entity) => ids.includes(entity.id)).map((entity) => entity.id);
  } catch {
    return entities.map((entity) => entity.id);
  }
}

export function entityLabelForShift(
  shift: Pick<ShiftWithCaregiver, 'entity_ids'>,
  entities: Array<Pick<Entity, 'id' | 'name'>>,
): string {
  const names = getShiftEntityNames(shift, entities);
  return names.length > 0 ? names.join(', ') : 'All patients';
}

export function getShiftStatusPresentation(shift: Pick<ShiftWithCaregiver, 'protocol_state' | 'resolvedStatus'>) {
  const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
    pending:   { bg: '#FFF7ED', text: '#C2410C', label: 'Awaiting confirmation' },
    confirmed: { bg: '#EFF6FF', text: '#2563EB', label: 'Confirmed' },
    active:    { bg: '#F0FDF4', text: '#16A34A', label: 'Active now' },
    completed: { bg: '#F1F5F9', text: '#64748B', label: 'Completed' },
    cancelled: { bg: '#FEF2F2', text: '#DC2626', label: 'Cancelled' },
    return_sent: { bg: '#FEFCE8', text: '#A16207', label: 'Awaiting primary ack' },
    return_pending_import: { bg: '#EFF6FF', text: '#1D4ED8', label: 'Importing return' },
    awaiting_cleanup_ack: { bg: '#F1F5F9', text: '#64748B', label: 'Cleanup sent' },
    rejected: { bg: '#FEF2F2', text: '#DC2626', label: 'Declined' },
  };
  return STATUS_STYLE[shift.protocol_state] ?? STATUS_STYLE[shift.resolvedStatus] ?? STATUS_STYLE.pending;
}

export function resolvePostAuthRoute(
  deepLink: string | null,
  notifRoute: string | null,
): string {
  if (deepLink) return deepLink;
  if (notifRoute) return notifRoute;
  return '/today';
}

export function buildParsedDeepLinkPath(parsed: {
  path?: string | null;
  queryParams?: Record<string, string | number | boolean | null | undefined> | null;
}): string | null {
  if (!parsed.path) return null;
  const qs = parsed.queryParams
    ? Object.entries(parsed.queryParams)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join('&')
    : '';
  return qs ? `/${parsed.path}?${qs}` : `/${parsed.path}`;
}
