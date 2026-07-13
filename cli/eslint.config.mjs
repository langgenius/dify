// @ts-check

import antfu, { GLOB_MARKDOWN } from '@antfu/eslint-config'
import md from 'eslint-markdown'
import markdownPreferences from 'eslint-plugin-markdown-preferences'

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
    ignores: (original) => ['context/**', 'docs/**', 'dist/**', 'coverage/**', ...original],
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
  {
    files: ['bin/**'],
    rules: {
      'antfu/no-top-level-await': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../**', './*/**', '..'],
              message:
                'Use the @/ (or @test/) alias for parent-directory or nested relative imports; keep ./ only for same-folder siblings.',
            },
          ],
        },
      ],
    },
  },
).override('antfu/sort/package-json', {
  rules: {
    'jsonc/sort-keys': 'off',
  },
})
