import {
  buildSupplyStatusLabel,
  buildSupplyStatusSub,
  buildDelegatedEntityIds,
  buildParsedDeepLinkPath,
  buildRefillHumanText,
  entityLabelForShift,
  getShiftEntityIds,
  getShiftStatusPresentation,
  locateDoseFocus,
  resolvePostAuthRoute,
  shouldOfferPrimaryRefillUpdate,
  summarizeTodaySections,
} from '../src/screens/criticalFlows';
import type { ScheduledDose } from '../src/db/doseLogs';

describe('critical screen flows', () => {
  const medication = {
    id: 'med-1',
    entity_id: 'entity-1',
    name: 'Metformin',
    dosage: '500 mg',
    pills_per_dose: 2,
    schedule: '{"type":"fixed_times","times":["08:00","20:00"]}',
    food_requirement: null,
    interactions: '[]',
    missed_policy: null,
    early_window_minutes: null,
    missed_window_minutes: null,
    color: '#123456',
    notes: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    deleted_at: null,
    rxcui: null,
    drug_info: null,
    pill_appearance: null,
  };

  it('only offers a primary refill update for shared entities with both phone and shift context', () => {
    expect(shouldOfferPrimaryRefillUpdate({
      shift_source: 'shared',
      shared_shift_id: 'shift-1',
      primary_phone: '5550001111',
    })).toBe(true);
    expect(shouldOfferPrimaryRefillUpdate({
      shift_source: 'local',
      shared_shift_id: 'shift-1',
      primary_phone: '5550001111',
    })).toBe(false);
    expect(shouldOfferPrimaryRefillUpdate({
      shift_source: 'shared',
      shared_shift_id: null,
      primary_phone: '5550001111',
    })).toBe(false);
    expect(buildRefillHumanText('Metformin', 90, 'pills')).toBe('Refill logged: Metformin — 90 pills.');
    expect(buildRefillHumanText('Metformin', 30, 'pills')).not.toContain('supply');
  });

  it('finds the exact dose card to focus and summarizes today counts by status', () => {
    const dueDose: ScheduledDose = {
      key: 'med-1|2026-06-11T08:00:00',
      medication,
      scheduledAt: '2026-06-11T08:00:00',
      timeLabel: '08:00',
      log: null,
      status: 'due',
      effectiveEarlyWindow: 30,
      effectiveMissedWindow: 60,
      effectiveMissedPolicy: 'none',
      shiftSource: 'local',
      sharedShiftId: null,
      entityPrimaryPhone: null,
    };
    const takenDose: ScheduledDose = {
      ...dueDose,
      key: 'med-1|2026-06-11T20:00:00',
      scheduledAt: '2026-06-11T20:00:00',
      timeLabel: '20:00',
      status: 'taken',
      log: { id: 'log-1' } as any,
    };
    const skippedDose: ScheduledDose = {
      ...dueDose,
      key: 'med-2|2026-06-11T09:00:00',
      medication: { ...medication, id: 'med-2', name: 'Warfarin' },
      scheduledAt: '2026-06-11T09:00:00',
      timeLabel: '09:00',
      status: 'skipped',
      log: { id: 'log-2' } as any,
    };

    const sections = [
      { data: [dueDose], doses: [dueDose] },
      { data: [takenDose, skippedDose], doses: [takenDose, skippedDose] },
    ];

    expect(locateDoseFocus(sections, { medId: 'med-1', scheduledAt: '2026-06-11T20:00:00' })).toEqual({
      sectionIndex: 1,
      itemIndex: 0,
      key: 'med-1|2026-06-11T20:00:00',
    });
    expect(summarizeTodaySections(sections)).toMatchObject({
      actionableCount: 1,
      settledCount: 2,
    });
  });

  it('builds delegated entity scope for today and caregiver messaging, including wildcard shifts', () => {
    const entities = [
      { id: 'entity-1', name: 'Pat Lee' },
      { id: 'entity-2', name: 'Sam Ray' },
    ];

    expect(buildDelegatedEntityIds({ entity_ids: '["*"]' } as any, entities.map((entity) => ({ entityId: entity.id }))))
      .toEqual(new Set(['entity-1', 'entity-2']));
    expect(getShiftEntityIds({ entity_ids: '["entity-2"]' } as any, entities)).toEqual(['entity-2']);
    expect(entityLabelForShift({ entity_ids: '["entity-1","entity-2"]' } as any, entities)).toBe('Pat Lee, Sam Ray');
  });

  it('prefers protocol status presentation and resolves post-auth routing in the right order', () => {
    expect(getShiftStatusPresentation({
      protocol_state: 'return_sent',
      resolvedStatus: 'active',
    } as any)).toMatchObject({ label: 'Awaiting primary ack' });

    expect(resolvePostAuthRoute('/caregivers/incoming?d=abc', '/today?medId=1')).toBe('/caregivers/incoming?d=abc');
    expect(resolvePostAuthRoute(null, '/today?medId=1')).toBe('/today?medId=1');
    expect(resolvePostAuthRoute(null, null)).toBe('/today');
  });

  it('rebuilds deep-link paths with encoded query params for foreground and cold-start routing', () => {
    expect(buildParsedDeepLinkPath({
      path: 'caregivers/incoming',
      queryParams: { d: 'abc 123', source: 'sms' },
    })).toBe('/caregivers/incoming?d=abc%20123&source=sms');

    expect(buildParsedDeepLinkPath({ path: null, queryParams: { d: 'abc' } })).toBeNull();
  });

  it('prefers cumulative units remaining over latest-entry days remaining for supply labels', () => {
    const status = {
      prescription: {
        unit: 'pills',
        quantity: 90,
        refill_date: '2026-06-05',
      },
      unitsRemaining: 87,
      daysRemaining: 84,
    };

    expect(buildSupplyStatusLabel(status as any, 'Unknown supply')).toBe('87 pills estimated remaining');
    expect(buildSupplyStatusLabel(null, 'Unknown supply')).toBe('Unknown supply');
  });

  it('describes supply estimates as cumulative even when showing the latest logged entry', () => {
    expect(buildSupplyStatusSub(null)).toBe('No starting supply or refill has been logged yet.');
    expect(buildSupplyStatusSub({
      quantity: 90,
      unit: 'pills',
      refill_date: '2026-06-05',
    } as any)).toContain('Estimate reflects all logged supply entries and taken doses.');
  });
});
