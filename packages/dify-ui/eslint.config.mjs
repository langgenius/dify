// @ts-check

import path from 'node:path'
import antfu, { GLOB_MARKDOWN_CODE, GLOB_TS, GLOB_TSX } from '@antfu/eslint-config'
import tailwindcss from 'eslint-plugin-better-tailwindcss'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import storybook from 'eslint-plugin-storybook'

const SOURCE_FILES = [GLOB_TS, GLOB_TSX]
const TEST_FILES = ['**/__tests__/**/*.{ts,tsx}', '**/*.spec.{ts,tsx}']

export default antfu(
  {
    ignores: [
      'coverage/',
      'dist/',
      'storybook-static/',
    ],
    react: {
      overrides: {
        'react/exhaustive-deps': ['error', { additionalHooks: 'useIsoLayoutEffect' }],
        'react/no-context-provider': 'off',
        'react/no-unnecessary-use-prefix': 'error',
        'react/no-use-context': 'off',
        'react/rules-of-hooks': 'error',
        'react/set-state-in-effect': 'error',
        'react/set-state-in-render': 'error',
        'react/static-components': 'error',
        'react-refresh/only-export-components': 'off',
      },
    },
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
    files: [GLOB_TSX],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      'jsx-a11y/anchor-has-content': 'off',
      'jsx-a11y/heading-has-content': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
  ...storybook.configs['flat/recommended'],
  {
    name: 'dify-ui/tailwind',
    files: SOURCE_FILES,
    ignores: [GLOB_MARKDOWN_CODE, ...TEST_FILES],
    plugins: {
      tailwindcss,
    },
    rules: {
      'tailwindcss/enforce-consistent-class-order': 'error',
      'tailwindcss/no-duplicate-classes': 'error',
      'tailwindcss/no-deprecated-classes': 'error',
      'tailwindcss/no-restricted-classes': ['error', {
        restrict: [
          {
            pattern: '^(-?)start-(.+)$',
            fix: '$1inset-s-$2',
            message: 'Use inset-s-* instead of the deprecated start-* utility.',
          },
          {
            pattern: '^(-?)end-(.+)$',
            fix: '$1inset-e-$2',
            message: 'Use inset-e-* instead of the deprecated end-* utility.',
          },
        ],
      }],
      'tailwindcss/no-unknown-classes': 'error',
      'tailwindcss/no-unnecessary-whitespace': 'error',
    },
    settings: {
      'better-tailwindcss': {
        cwd: import.meta.dirname,
        entryPoint: path.resolve(import.meta.dirname, './.storybook/storybook.css'),
      },
    },
  },
  {
    name: 'dify-ui/import-boundaries',
    files: SOURCE_FILES,
    ignores: [GLOB_MARKDOWN_CODE],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          'i18next',
          'jotai',
          'ky',
          'next',
          'next-i18next',
          'react-i18next',
          'zustand',
          {
            name: '@tanstack/react-query',
            message: 'Application data fetching belongs in web, not @langgenius/dify-ui.',
          },
        ],
        patterns: [
          {
            group: ['@/*', 'web', 'web/*', '**/web/**'],
            message: 'Do not import from web inside @langgenius/dify-ui.',
          },
          {
            group: ['@langgenius/dify-ui', '@langgenius/dify-ui/*'],
            message: 'Use relative imports between @langgenius/dify-ui components.',
          },
          {
            group: ['next/*'],
            message: 'Next.js dependencies belong in web, not @langgenius/dify-ui.',
          },
        ],
      }],
    },
  },
  {
    files: TEST_FILES,
    rules: {
      'react/purity': 'off',
    },
  },
  {
    rules: {
      'node/prefer-global/process': 'off',
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
)
