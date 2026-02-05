// @ts-check
import antfu from '@antfu/eslint-config'
import pluginQuery from '@tanstack/eslint-plugin-query'
import tailwindcss from 'eslint-plugin-better-tailwindcss'
import sonar from 'eslint-plugin-sonarjs'
import storybook from 'eslint-plugin-storybook'
import dify from './eslint-rules/index.js'

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
    ignores: ['public', 'types/doc-paths.ts', 'eslint-suppressions.json'],
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
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      tailwindcss,
    },
    rules: {
      'tailwindcss/enforce-consistent-class-order': 'error',
      'tailwindcss/no-duplicate-classes': 'error',
      'tailwindcss/no-unnecessary-whitespace': 'error',
      'tailwindcss/no-unknown-classes': 'warn',
    },
  },
  {
    plugins: { dify },
  },
  {
    files: ['i18n/**/*.json'],
    rules: {
      'sonarjs/max-lines': 'off',
      'max-lines': 'off',
      'jsonc/sort-keys': 'error',

      'dify/valid-i18n-keys': 'error',
      'dify/no-extra-keys': 'error',
      'dify/consistent-placeholders': 'error',
    },
  },
  {
    files: ['**/package.json'],
    rules: {
      'dify/no-version-prefix': 'error',
    },
  },
)
