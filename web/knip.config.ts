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
  ignoreDependencies: [],
  rules: {
    files: 'warn',
    dependencies: 'warn',
    devDependencies: 'warn',
    optionalPeerDependencies: 'warn',
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
