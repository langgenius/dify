import type { KnipConfig } from 'knip'

/**
 * @see https://knip.dev/reference/configuration
 */
const config: KnipConfig = {
  compilers: {
    mdx: true,
  },
  entry: [
    'scripts/**/*.{js,ts,mjs}',
    'bin/**/*.{js,ts,mjs}',
    'tsslint.config.ts',
    'dev-proxy.config.ts',
    'plugins/eslint/index.js',
  ],
  project: [
    '**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,css,mdx}!',
    '!**/*.{bench,test,test-d,spec,spec-d}.?(c|m)[jt]s?(x)!',
    '!**/*.test-utils.{ts,tsx}!',
    '!**/__mocks__/**!',
    '!**/__tests__/**!',
    '!**/*.stories.{js,jsx,ts,tsx,mdx}!',
    '!.storybook/**!',
    '!context/provider-context-mock.tsx!',
    '!plugins/**!',
    '!test/**!',
    '!**/test-helpers.{ts,tsx}!',
    '!**/test-utils.{ts,tsx}!',
    '!vitest.setup.ts!',
  ],
  ignore: ['public/**'],
  ignoreFiles: [
    'features/agent-v2/agent-detail/configure/components/orchestrate/memory.tsx',
    'features/agent-v2/agent-detail/configure/components/orchestrate/prompt-editor/option-menu.tsx',
    'i18n-config/locale-resources/*.ts',
  ],
  ignoreDependencies: ['@iconify-json/*', '@storybook/addon-onboarding', 'eslint'],
  /// keep-sorted
  rules: {
    // TODO: fix these warnings
    // Unlisted binaries (1)
    // vp      package.json
    binaries: 'warn',
    catalog: 'error',
    dependencies: 'error',
    devDependencies: 'warn',
    duplicates: 'error',
    enumMembers: 'error',
    exports: 'error',
    files: 'error',
    namespaceMembers: 'error',
    nsExports: 'error',
    nsTypes: 'error',
    optionalPeerDependencies: 'error',
    types: 'error',
    unlisted: 'error',
    unresolved: 'error',
  },
}

export default config
