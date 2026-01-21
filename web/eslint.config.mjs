// @ts-check
import antfu from '@antfu/eslint-config'
import pluginQuery from '@tanstack/eslint-plugin-query'
import sonar from 'eslint-plugin-sonarjs'
import storybook from 'eslint-plugin-storybook'
import tailwind from 'eslint-plugin-tailwindcss'
import difyI18n from './eslint-rules/index.js'

export default antfu(
  {
    react: {
      // This react compiler rules are pretty slow
      // We can wait for https://github.com/Rel1cx/eslint-react/issues/1237
      reactCompiler: false,
      overrides: {
        'react/no-context-provider': 'off',
        'react/no-forward-ref': 'off',
        'react/no-use-context': 'off',

        // prefer react-hooks-extra/no-direct-set-state-in-use-effect
        'react-hooks/set-state-in-effect': 'off',
        'react-hooks-extra/no-direct-set-state-in-use-effect': 'error',
      },
    },
    nextjs: true,
    ignores: ['public', 'types/doc-paths.ts'],
    typescript: {
      overrides: {
        'ts/consistent-type-definitions': ['error', 'type'],
        'ts/no-explicit-any': 'error',
      },
    },
    test: {
      overrides: {
        'test/prefer-lowercase-title': 'off',
      },
    },
    stylistic: {
      overrides: {
        'antfu/top-level-function': 'off',
      },
    },
  },
  {
    rules: {
      'node/prefer-global/process': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    settings: {
      'react-x': {
        additionalStateHooks: '/^use\\w*State(?:s)?|useAtom$/u',
      },
    },
  },
  storybook.configs['flat/recommended'],
  ...pluginQuery.configs['flat/recommended'],
  // sonar
  {
    rules: {
      // Manually pick rules that are actually useful and not slow.
      // Or we can just drop the plugin entirely.
    },
    plugins: {
      sonarjs: sonar,
    },
  },
  tailwind.configs['flat/recommended'],
  {
    settings: {
      tailwindcss: {
        // These are the default values but feel free to customize
        callees: ['classnames', 'clsx', 'ctl', 'cn', 'classNames'],
        config: 'tailwind.config.js', // returned from `loadConfig()` utility if not provided
        cssFiles: [
          '**/*.css',
          '!**/node_modules',
          '!**/.*',
          '!**/dist',
          '!**/build',
          '!**/.storybook',
          '!**/.next',
          '!**/.public',
        ],
        cssFilesRefreshRate: 5_000,
        removeDuplicates: true,
        skipClassAttribute: false,
        whitelist: [],
        tags: [], // can be set to e.g. ['tw'] for use in tw`bg-blue`
        classRegex: '^class(Name)?$', // can be modified to support custom attributes. E.g. "^tw$" for `twin.macro`
      },
    },
    rules: {
      // due to 1k lines of tailwind config, these rule have performance issue
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',

      'tailwindcss/no-arbitrary-value': 'off',
      'tailwindcss/classnames-order': 'warn',
      'tailwindcss/enforces-negative-arbitrary-values': 'warn',
      'tailwindcss/migration-from-tailwind-2': 'warn',
    },
  },
  // dify i18n namespace migration
  // {
  //   files: ['**/*.ts', '**/*.tsx'],
  //   ignores: ['eslint-rules/**', 'i18n/**', 'i18n-config/**'],
  //   plugins: {
  //     'dify-i18n': difyI18n,
  //   },
  //   rules: {
  //     // 'dify-i18n/no-as-any-in-t': ['error', { mode: 'all' }],
  //     'dify-i18n/no-as-any-in-t': 'error',
  //     // 'dify-i18n/no-legacy-namespace-prefix': 'error',
  //     // 'dify-i18n/require-ns-option': 'error',
  //   },
  // },
  // i18n JSON validation rules
  {
    files: ['i18n/**/*.json'],
    plugins: {
      'dify-i18n': difyI18n,
    },
    rules: {
      'sonarjs/max-lines': 'off',
      'max-lines': 'off',
      'jsonc/sort-keys': 'error',

      'dify-i18n/valid-i18n-keys': 'error',
      'dify-i18n/no-extra-keys': 'error',
      'dify-i18n/consistent-placeholders': 'error',
    },
  },
  // package.json version prefix validation
  {
    files: ['**/package.json'],
    plugins: {
      'dify-i18n': difyI18n,
    },
    rules: {
      'dify-i18n/no-version-prefix': 'error',
    },
  },
)
