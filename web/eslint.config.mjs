// @ts-check

import path from 'node:path'
import antfu, { GLOB_MARKDOWN, GLOB_MARKDOWN_CODE, GLOB_TESTS, GLOB_TS, GLOB_TSX } from '@antfu/eslint-config'
import pluginQuery from '@tanstack/eslint-plugin-query'
import md from 'eslint-markdown'
import tailwindcss from 'eslint-plugin-better-tailwindcss'
import hyoban from 'eslint-plugin-hyoban'
import markdownPreferences from 'eslint-plugin-markdown-preferences'
import noBarrelFiles from 'eslint-plugin-no-barrel-files'
import sonar from 'eslint-plugin-sonarjs'
import storybook from 'eslint-plugin-storybook'
import {
  GENERATED_IGNORES,
  HYOBAN_PREFER_TAILWIND_ICONS_OPTIONS,
  NEXT_PLATFORM_RESTRICTED_IMPORT_PATHS,
  WEB_RESTRICTED_IMPORT_PATTERNS,
} from './eslint.constants.mjs'
import dify from './plugins/eslint/index.js'

export default antfu(
  {
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
    stylistic: {
      overrides: {
        'antfu/top-level-function': 'off',
      },
    },
    e18e: false,
    pnpm: false,
  },
  {
    files: [...GLOB_TESTS, GLOB_MARKDOWN_CODE, 'vitest.setup.ts', 'test/i18n-mock.ts'],
    rules: {
      'react/component-hook-factories': 'off',
      'react/no-unnecessary-use-prefix': 'off',
    },
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
  markdownPreferences.configs.standard,
  {
    files: [GLOB_MARKDOWN],
    plugins: { md },
    rules: {
      'md/no-url-trailing-slash': 'error',
      'markdown-preferences/prefer-link-reference-definitions': [
        'error',
        {
          minLinks: 1,
        },
      ],
      'markdown-preferences/ordered-list-marker-sequence': [
        'error',
        { increment: 'never' },
      ],
      'markdown-preferences/definitions-last': 'error',
      'markdown-preferences/sort-definitions': 'error',
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
    files: [GLOB_TS, GLOB_TSX],
    ignores: GLOB_TESTS,
    plugins: {
      tailwindcss,
    },
    rules: {
      'tailwindcss/enforce-consistent-class-order': 'error',
      'tailwindcss/no-duplicate-classes': 'error',
      'tailwindcss/no-unnecessary-whitespace': 'error',
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
      'sonarjs/max-lines': 'off',
      'max-lines': 'off',
      'jsonc/sort-keys': 'error',

      'hyoban/i18n-flat-key': 'error',
      'dify/no-extra-keys': 'error',
      'dify/consistent-placeholders': 'error',
    },
  },
  {
    files: ['package.json'],
    rules: {
      'hyoban/no-dependency-version-prefix': 'error',
    },
  },
  {
    name: 'dify/restricted-imports',
    files: [GLOB_TS, GLOB_TSX],
    ignores: ['next/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: NEXT_PLATFORM_RESTRICTED_IMPORT_PATHS,
        patterns: WEB_RESTRICTED_IMPORT_PATTERNS,
      }],
    },
  },
)
