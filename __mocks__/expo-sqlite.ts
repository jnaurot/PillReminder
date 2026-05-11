export function openDatabaseAsync() {
  return Promise.resolve({
    execAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
    runAsync: jest.fn(),
  });
}
