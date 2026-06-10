// @ts-check

import antfu, { GLOB_MARKDOWN } from '@antfu/eslint-config'
import md from 'eslint-markdown'
import markdownPreferences from 'eslint-plugin-markdown-preferences'

export default antfu(
  {
    ignores: original => [
      'context/**',
      'docs/**',
      'dist/**',
      'coverage/**',
      ...original,
    ],
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
    files: ['bin/**'],
    rules: {
      'antfu/no-top-level-await': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../**', './*/**', '..'],
            message: 'Use the @/ (or @test/) alias for parent-directory or nested relative imports; keep ./ only for same-folder siblings.',
          },
        ],
      }],
    },
  },
)
