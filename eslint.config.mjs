// @ts-check

import antfu, { GLOB_MARKDOWN } from '@antfu/eslint-config'
import md from 'eslint-markdown'
import markdownPreferences from 'eslint-plugin-markdown-preferences'

const GENERATED_IGNORES = [
  '**/storybook-static/',
  '**/.next/',
  '**/.vinext/',
  'web/next/',
  'web/next-env.d.ts',
  '**/dist/',
  '**/coverage/',
  'e2e/.auth/',
  'e2e/cucumber-report/',
]

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
    ignores: (original) => [
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
    e18e: false,
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
).override('antfu/sort/package-json', {
  rules: {
    'jsonc/sort-keys': 'off',
  },
})
