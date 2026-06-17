jest.mock('../src/db/database', () => ({ getDb: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn(),
  EncodingType: { UTF8: 'utf8' },
}));
jest.mock('expo-sharing', () => ({
  __esModule: true,
  shareAsync: jest.fn(),
}));

import { getDb } from '../src/db/database';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { exportCSV } from '../src/db/backup';

describe('exportCSV', () => {
  const getAllAsync = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-16T12:00:00.000Z'));
    jest.clearAllMocks();
    (getDb as jest.Mock).mockReturnValue({ getAllAsync });
    getAllAsync.mockResolvedValue([
      {
        person: 'Alex',
        medication: 'Lisinopril',
        dosage: '10 mg',
        scheduled_at: '2026-06-16T08:00:00',
        taken_at: '2026-06-16T08:02:00',
        skipped: 0,
        is_catchup: 0,
        notes: null,
      },
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exports all active users when no user filter is selected', async () => {
    await exportCSV();

    expect(getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('WHERE e.deleted_at IS NULL AND m.deleted_at IS NULL'),
      [],
    );
    expect(getAllAsync.mock.calls[0][0]).not.toContain('AND e.id = ?');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/pillreminder-doses-2026-06-16.csv',
      expect.stringContaining('Person,Medication,Dosage,Scheduled At,Taken At,Skipped,Catch-up,Notes'),
      { encoding: 'utf8' },
    );
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      'file:///cache/pillreminder-doses-2026-06-16.csv',
      expect.objectContaining({ mimeType: 'text/csv', dialogTitle: 'Export Dose History' }),
    );
  });

  it('filters the exported CSV to a single user when an entity id is provided', async () => {
    await exportCSV('entity-1');

    expect(getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('AND e.id = ?'),
      ['entity-1'],
    );
  });
});
