import antfu, { GLOB_MARKDOWN } from '@antfu/eslint-config'
import md from 'eslint-markdown'
import markdownPreferences from 'eslint-plugin-markdown-preferences'

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
      ...original,
    ],
    react: {
      files: ['packages/dify-ui/**/*.{ts,tsx}'],
      overrides: {
        'react/set-state-in-effect': 'error',
        'react/no-unnecessary-use-prefix': 'error',
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
  },
  {
    files: ['packages/dify-ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
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
)
