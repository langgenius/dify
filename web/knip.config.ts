import type { KnipConfig } from 'knip'

/**
 * @see https://knip.dev/reference/configuration
 */
const config: KnipConfig = {
  entry: [
    'scripts/**/*.{js,ts,mjs}',
    'bin/**/*.{js,ts,mjs}',
    'tsslint.config.ts',
    'openapi-ts.*.config.ts',
  ],
  ignore: [
    'public/**',
    'contract/generated/**',
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
    // TODO: fix these warnings
    // Unused devDependencies (3)
    // @eslint-react/eslint-plugin  package.json:160:6
    // @next/eslint-plugin-next     package.json:168:6
    // eslint-plugin-react-refresh  package.json:211:6
    // Unlisted binaries (2)
    // eslint  package.json
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
