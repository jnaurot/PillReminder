export function normalizeName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function normalizeDate(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return '';

  // Accept YYYY-MM-DD, YYYY/MM/DD
  const isoMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Accept MM-DD-YYYY, MM/DD/YYYY
  const usMatch = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Accept 8-digit run: MMDDYYYY or YYYYMMDD
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 8) {
    const asYMD = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const year = parseInt(digits.slice(0, 4), 10);
    if (year >= 1900 && year <= 2100) return asYMD;

    // Treat as MMDDYYYY
    return `${digits.slice(4, 8)}-${digits.slice(0, 2)}-${digits.slice(2, 4)}`;
  }

  return cleaned;
}
