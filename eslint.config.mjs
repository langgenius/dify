// @ts-check

import antfu, { GLOB_MARKDOWN } from '@antfu/eslint-config'
import md from 'eslint-markdown'
import markdownPreferences from 'eslint-plugin-markdown-preferences'

const GENERATED_IGNORES = [
  '**/storybook-static/',
  '**/.next/',
  'web/next/',
  'web/next-env.d.ts',
  '**/dist/',
  '**/coverage/',
  'e2e/.auth/',
  'e2e/cucumber-report/',
]

export default antfu(
  {
    ignores: original => [
      '**',
      '!packages/**',
      '!web/**',
      '!e2e/**',
      '!eslint.config.mjs',
      '!package.json',
      '!pnpm-workspace.yaml',
      '!vite.config.ts',
      ...GENERATED_IGNORES,
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
)
