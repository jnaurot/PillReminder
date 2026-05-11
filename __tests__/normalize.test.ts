/**
 * Regression tests for normalizeName.
 */

import { normalizeName } from '../src/utils/normalize';

describe('normalizeName — passing values', () => {
  it('capitalizes each word', () => {
    expect(normalizeName('john doe')).toBe('John Doe');
  });

  it('handles mixed case input', () => {
    expect(normalizeName('jOhN DoE')).toBe('John Doe');
  });

  it('handles all caps input', () => {
    expect(normalizeName('JOHN DOE')).toBe('John Doe');
  });

  it('handles extra internal spaces', () => {
    expect(normalizeName('john    doe')).toBe('John Doe');
  });

  it('handles leading/trailing spaces', () => {
    expect(normalizeName('  john doe  ')).toBe('John Doe');
  });

  it('handles compound leading/trailing/internal spaces', () => {
    expect(normalizeName('  john    doe  ')).toBe('John Doe');
  });

  it('handles single word', () => {
    expect(normalizeName('aspirin')).toBe('Aspirin');
  });

  it('handles three-word names', () => {
    expect(normalizeName('metformin hcl er')).toBe('Metformin Hcl Er');
  });
});

describe('normalizeName — boundary / edge values', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeName('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeName('   ')).toBe('');
  });

  it('handles hyphenated names', () => {
    expect(normalizeName('sodium-chloride')).toBe('Sodium-chloride');
  });

  it('handles names with numbers', () => {
    expect(normalizeName('vitamin d3')).toBe('Vitamin D3');
  });

  it('handles single character', () => {
    expect(normalizeName('a')).toBe('A');
  });

  it('handles single character with spaces', () => {
    expect(normalizeName('  a  ')).toBe('A');
  });
});
