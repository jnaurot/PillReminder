/**
 * Regression tests for type parsing helpers.
 *
 * parseSchedule  — must return a valid MedicationSchedule or fallback.
 * parseInteractions — must return MedicationInteraction[] or empty array.
 */

import { parseSchedule, parseInteractions } from '../src/types';

describe('parseSchedule — passing values', () => {
  it('parses fixed_times schedule', () => {
    const result = parseSchedule('{"type":"fixed_times","times":["08:00","20:00"]}');
    expect(result).toEqual({ type: 'fixed_times', times: ['08:00', '20:00'] });
  });

  it('parses prn schedule', () => {
    const result = parseSchedule('{"type":"prn","max_doses_per_day":4,"min_interval_hours":4}');
    expect(result).toEqual({ type: 'prn', max_doses_per_day: 4, min_interval_hours: 4 });
  });

  it('parses weekly schedule', () => {
    const result = parseSchedule('{"type":"weekly","days":[1,3,5],"times":["09:00"]}');
    expect(result).toEqual({ type: 'weekly', days: [1, 3, 5], times: ['09:00'] });
  });

  it('parses monthly schedule', () => {
    const result = parseSchedule('{"type":"monthly","days":[1,15],"times":["08:00","20:00"]}');
    expect(result).toEqual({ type: 'monthly', days: [1, 15], times: ['08:00', '20:00'] });
  });

  it('handles empty times array', () => {
    const result = parseSchedule('{"type":"fixed_times","times":[]}');
    expect(result).toEqual({ type: 'fixed_times', times: [] });
  });
});

describe('parseSchedule — failing / fallback values', () => {
  it('returns fallback on invalid JSON', () => {
    const result = parseSchedule('not-json');
    expect(result).toEqual({ type: 'fixed_times', times: [] });
  });

  it('returns fallback on empty string', () => {
    const result = parseSchedule('');
    expect(result).toEqual({ type: 'fixed_times', times: [] });
  });

  it('returns fallback on null-like string', () => {
    const result = parseSchedule('null');
    expect(result).toEqual({ type: 'fixed_times', times: [] });
  });

  it('returns fallback on undefined-like string', () => {
    const result = parseSchedule('undefined');
    expect(result).toEqual({ type: 'fixed_times', times: [] });
  });

  it('returns fallback on partial/corrupt JSON', () => {
    const result = parseSchedule('{"type":"fixed_times","times":[');
    expect(result).toEqual({ type: 'fixed_times', times: [] });
  });

  it('returns fallback on JSON array instead of object', () => {
    const result = parseSchedule('[1,2,3]');
    expect(result).toEqual({ type: 'fixed_times', times: [] });
  });
});

describe('parseInteractions — passing values', () => {
  it('parses "with" interaction', () => {
    const result = parseInteractions('[{"type":"with","medication_id":"m1","medication_name":"Aspirin"}]');
    expect(result).toEqual([{ type: 'with', medication_id: 'm1', medication_name: 'Aspirin' }]);
  });

  it('parses "hours_after" interaction', () => {
    const result = parseInteractions('[{"type":"hours_after","medication_id":"m2","medication_name":"Ibuprofen","hours":4}]');
    expect(result).toEqual([{ type: 'hours_after', medication_id: 'm2', medication_name: 'Ibuprofen', hours: 4 }]);
  });

  it('parses empty array', () => {
    const result = parseInteractions('[]');
    expect(result).toEqual([]);
  });

  it('parses multiple interactions', () => {
    const result = parseInteractions(
      '[{"type":"with","medication_id":"m1","medication_name":"A"},{"type":"hours_after","medication_id":"m2","medication_name":"B","hours":2}]',
    );
    expect(result).toHaveLength(2);
  });
});

describe('parseInteractions — failing / fallback values', () => {
  it('returns empty array on invalid JSON', () => {
    const result = parseInteractions('not-json');
    expect(result).toEqual([]);
  });

  it('returns empty array on empty string', () => {
    const result = parseInteractions('');
    expect(result).toEqual([]);
  });

  it('returns empty array on JSON object instead of array', () => {
    const result = parseInteractions('{"foo":"bar"}');
    expect(result).toEqual([]);
  });

  it('returns empty array on partial/corrupt JSON', () => {
    const result = parseInteractions('[{"type":"with",');
    expect(result).toEqual([]);
  });
});
