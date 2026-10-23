/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  // 复用仓库根依赖（node-html-parser 等）
  modulePaths: ['<rootDir>/node_modules', '<rootDir>/../node_modules'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)',
  ],
  testMatch: ['**/__tests__/**/*.test.ts'],
  clearMocks: true,
};
