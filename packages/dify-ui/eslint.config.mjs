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
    ignores: ['coverage/', 'dist/', 'storybook-static/'],
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
    e18e: false,
    pnpm: false,
  },
  {
    files: [GLOB_TSX],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      'jsx-a11y/anchor-has-content': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
  ...storybook.configs['flat/recommended'],
  {
    name: 'dify-ui/storybook',
    files: ['**/.storybook/main.{js,cjs,mjs,ts}'],
    rules: {
      'storybook/no-uninstalled-addons': [
        'error',
        {
          packageJsonLocation: path.resolve(import.meta.dirname, 'package.json'),
        },
      ],
    },
  },
  {
    name: 'dify-ui/tailwind',
    files: SOURCE_FILES,
    ignores: [GLOB_MARKDOWN_CODE, ...TEST_FILES],
    plugins: {
      tailwindcss,
    },
    rules: {
      'tailwindcss/no-deprecated-classes': 'error',
      'tailwindcss/no-unknown-classes': 'error',
    },
    settings: {
      'better-tailwindcss': {
        cwd: import.meta.dirname,
        entryPoint: path.resolve(import.meta.dirname, './.storybook/storybook.css'),
      },
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
      'unicorn/number-literal-case': 'off',
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
).override('antfu/sort/package-json', {
  rules: {
    'jsonc/sort-keys': 'off',
  },
})
