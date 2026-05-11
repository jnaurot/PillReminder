/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  clearMocks: false,
  resetMocks: false,
  restoreMocks: false,
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^expo-router$': '<rootDir>/__mocks__/expo-router.ts',
    '^expo-sqlite$': '<rootDir>/__mocks__/expo-sqlite.ts',
    '^react-native$': '<rootDir>/__mocks__/react-native.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
