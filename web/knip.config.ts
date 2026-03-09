import type { KnipConfig } from 'knip'

/**
 * @see https://knip.dev/reference/configuration
 */
const config: KnipConfig = {
  entry: [
    'scripts/**/*.{js,ts,mjs}',
    'bin/**/*.{js,ts,mjs}',
  ],
  ignore: [
    'i18n/**',
    'public/**',
  ],
  ignoreBinaries: [
    'only-allow',
  ],
  ignoreDependencies: [
    '@iconify-json/*',

    '@storybook/addon-onboarding',

    // vinext related
    'react-server-dom-webpack',
    '@vitejs/plugin-rsc',
    '@mdx-js/rollup',

    '@tsslint/compat-eslint',
    '@tsslint/config',
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
    classMembers: 'warn',
    types: 'warn',
    nsTypes: 'warn',
    enumMembers: 'warn',
    duplicates: 'warn',
  },
}

export default config
