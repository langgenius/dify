// @ts-check

import path from 'node:path'
import antfu, {
  GLOB_JS,
  GLOB_JSX,
  GLOB_MARKDOWN,
  GLOB_MARKDOWN_CODE,
  GLOB_TESTS,
  GLOB_TS,
  GLOB_TSX,
} from '@antfu/eslint-config'
import pluginQuery from '@tanstack/eslint-plugin-query'
import md from 'eslint-markdown'
import tailwindcss from 'eslint-plugin-better-tailwindcss'
import hyoban from 'eslint-plugin-hyoban'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import markdownPreferences from 'eslint-plugin-markdown-preferences'
import noBarrelFiles from 'eslint-plugin-no-barrel-files'
import storybook from 'eslint-plugin-storybook'
import { rulesMigratedToOxlint } from '../eslint.migrated-rules.mjs'
import {
  GENERATED_IGNORES,
  HYOBAN_PREFER_TAILWIND_ICONS_OPTIONS,
  NEXT_PLATFORM_RESTRICTED_IMPORT_PATHS,
  WEB_RESTRICTED_IMPORT_PATTERNS,
  WEB_SERVICE_BASE_RESTRICTED_IMPORT_PATTERNS,
  WEB_SERVICE_FETCH_RESTRICTED_IMPORT_PATTERNS,
} from './eslint.constants.mjs'
import dify from './plugins/eslint/index.js'

export default antfu(
  {
    stylistic: false,
    perfectionist: {
      overrides: {
        'perfectionist/sort-imports': 'off',
      },
    },
    jsonc: {
      overrides: {
        'jsonc/space-unary-ops': 'off',
      },
    },
    yaml: {
      overrides: {
        'yaml/block-mapping': 'off',
        'yaml/block-sequence': 'off',
        'yaml/plain-scalar': 'off',
      },
    },
    toml: {
      overrides: {
        'toml/comma-style': 'off',
        'toml/no-space-dots': 'off',
      },
    },
    react: {
      overrides: {
        'react/set-state-in-effect': 'error',
        'react/no-unnecessary-use-prefix': 'error',
      },
    },
    ignores: ['public', 'types/doc-paths.ts', 'eslint-suppressions.json', ...GENERATED_IGNORES],
    typescript: {
      overrides: {
        'ts/consistent-type-definitions': ['error', 'type'],
        'ts/no-explicit-any': 'error',
        'ts/no-redeclare': 'off',
      },
      erasableOnly: true,
    },
    test: {
      overrides: {
        'test/prefer-lowercase-title': 'off',
      },
    },
    e18e: false,
    pnpm: false,
  },
  {
    files: [...GLOB_TESTS, GLOB_MARKDOWN_CODE, 'vitest.setup.ts', 'test/i18n-mock.ts'],
    rules: {
      'react/no-unnecessary-use-prefix': 'off',
    },
  },
  {
    files: [GLOB_TSX],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    plugins: {
      'no-barrel-files': noBarrelFiles,
    },
    ignores: ['next/**'],
    rules: {
      'no-barrel-files/no-barrel-files': 'error',
    },
  },
  {
    files: [GLOB_MARKDOWN],
    plugins: {
      md,
      'markdown-preferences': markdownPreferences,
    },
    rules: {
      'md/no-url-trailing-slash': 'error',
      'markdown-preferences/definitions-last': 'error',
      'markdown-preferences/prefer-link-reference-definitions': [
        'error',
        {
          minLinks: 1,
        },
      ],
      'markdown-preferences/sort-definitions': 'error',
    },
  },
  {
    rules: {
      'node/prefer-global/process': 'off',
      'unicorn/number-literal-case': 'off',
    },
  },
  {
    files: [GLOB_JS, GLOB_JSX, GLOB_TS, GLOB_TSX],
    ignores: [GLOB_MARKDOWN_CODE],
    rules: rulesMigratedToOxlint,
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
  {
    files: [GLOB_TS, GLOB_TSX],
    ignores: GLOB_TESTS,
    plugins: {
      tailwindcss,
    },
    rules: {
      'tailwindcss/no-duplicate-classes': 'error',
      'tailwindcss/no-unknown-classes': 'warn',
    },
    settings: {
      'better-tailwindcss': {
        cwd: import.meta.dirname,
        entryPoint: path.resolve(import.meta.dirname, './app/styles/globals.css'),
      },
    },
  },
  {
    name: 'dify/custom/setup',
    plugins: {
      dify,
      hyoban,
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      'hyoban/prefer-tailwind-icons': ['warn', HYOBAN_PREFER_TAILWIND_ICONS_OPTIONS],
    },
  },
  {
    files: ['i18n/**/*.json'],
    rules: {
      'jsonc/sort-keys': 'error',
      'max-lines': 'off',

      'hyoban/i18n-flat-key': 'error',
      'dify/no-extra-keys': 'error',
      'dify/consistent-placeholders': 'error',
    },
  },
  {
    name: 'dify/restricted-imports',
    files: [GLOB_TS, GLOB_TSX],
    ignores: ['next/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NEXT_PLATFORM_RESTRICTED_IMPORT_PATHS,
          patterns: WEB_RESTRICTED_IMPORT_PATTERNS,
        },
      ],
    },
  },
  {
    name: 'dify/service-base-restricted-imports',
    files: ['service/**/*.ts', 'service/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NEXT_PLATFORM_RESTRICTED_IMPORT_PATHS,
          patterns: [
            ...WEB_RESTRICTED_IMPORT_PATTERNS,
            ...WEB_SERVICE_BASE_RESTRICTED_IMPORT_PATTERNS,
            ...WEB_SERVICE_FETCH_RESTRICTED_IMPORT_PATTERNS,
          ],
        },
      ],
    },
  },
  {
    name: 'dify/restricted-local-storage-access',
    files: [GLOB_TS, GLOB_TSX],
    ignores: [...GLOB_TESTS, 'vitest.setup.ts', 'instrumentation-client.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'Do not use localStorage directly. Use a foxact storage boundary instead; prefer feature-owned createLocalStorageState for shared storage.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message:
            'Do not use window.localStorage directly. Use a foxact storage boundary instead; prefer feature-owned createLocalStorageState for shared storage.',
        },
        {
          object: 'globalThis',
          property: 'localStorage',
          message:
            'Do not use globalThis.localStorage directly. Use a foxact storage boundary instead; prefer feature-owned createLocalStorageState for shared storage.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportDeclaration[source.value="ahooks"] ImportSpecifier[imported.name="useLocalStorageState"]',
          message: 'Do not use ahooks useLocalStorageState. Use foxact storage hooks instead.',
        },
      ],
    },
  },
).override('antfu/sort/package-json', {
  rules: {
    'jsonc/sort-keys': 'off',
  },
})
