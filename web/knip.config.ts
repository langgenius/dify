import type { KnipConfig } from 'knip'

/**
 * @see https://knip.dev/reference/configuration
 */
const config: KnipConfig = {
  entry: [
    'scripts/**/*.{js,ts,mjs}',
    'bin/**/*.{js,ts,mjs}',
    'tsslint.config.ts',
  ],
  ignore: [
    'public/**',
  ],
  ignoreBinaries: [
    'only-allow',
  ],
  ignoreDependencies: [
    '@iconify-json/*',
    '@storybook/addon-onboarding',
  ],
  /// keep-sorted
  rules: {
    binaries: 'error',
    catalog: 'error',
    dependencies: 'error',
    devDependencies: 'error',
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
