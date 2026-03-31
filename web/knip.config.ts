import type { KnipConfig } from 'knip'

/**
 * @see https://knip.dev/reference/configuration
 */
const config: KnipConfig = {
  entry: [
    'scripts/**/*.{js,ts,mjs}',
    'bin/**/*.{js,ts,mjs}',
    'taze.config.js',
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
  rules: {
    files: 'warn',
    dependencies: 'error',
    devDependencies: 'error',
    optionalPeerDependencies: 'error',
    unlisted: 'warn',
    unresolved: 'warn',
    exports: 'warn',
    nsExports: 'warn',
    types: 'warn',
    nsTypes: 'warn',
    enumMembers: 'warn',
    duplicates: 'warn',
  },
}

export default config
