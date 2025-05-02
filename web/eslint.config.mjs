import {
  GLOB_TESTS, combine, javascript, node,
  stylistic, typescript, unicorn,
} from '@antfu/eslint-config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'
import globals from 'globals'
import storybook from 'eslint-plugin-storybook'
import { fixupConfigRules } from '@eslint/compat'
import tailwind from 'eslint-plugin-tailwindcss'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default combine(
  stylistic({
    lessOpinionated: true,
    // original @antfu/eslint-config does not support jsx
    jsx: false,
    semi: false,
    quotes: 'single',
    overrides: {
      // original config
      'style/indent': ['error', 2],
      'style/quotes': ['error', 'single'],
      'curly': ['error', 'multi-or-nest', 'consistent'],
      'style/comma-spacing': ['error', { before: false, after: true }],
      'style/quote-props': ['warn', 'consistent-as-needed'],

      // these options does not exist in old version
      // maybe useless
      'style/indent-binary-ops': 'off',
      'style/multiline-ternary': 'off',
      'antfu/top-level-function': 'off',
      'antfu/curly': 'off',
      'antfu/consistent-chaining': 'off',

      // copy from eslint-config-antfu 0.36.0
      'style/brace-style': ['error', 'stroustrup', { allowSingleLine: true }],
      'style/dot-location': ['error', 'property'],
      'style/object-curly-newline': ['error', { consistent: true, multiline: true }],
      'style/object-property-newline': ['error', { allowMultiplePropertiesPerLine: true }],
      'style/template-curly-spacing': ['error', 'never'],
      'style/keyword-spacing': 'off',

      // not exist in old version, and big change
      'style/member-delimiter-style': 'off',
    },
  }),
  javascript({
    overrides: {
      // handled by unused-imports/no-unused-vars
      'no-unused-vars': 'off',
    },
  }),
  typescript({
    overrides: {
      // original config
      'ts/consistent-type-definitions': ['warn', 'type'],

      // useful, but big change
      'ts/no-empty-object-type': 'off',
    },
  }),
  unicorn(),
  node(),
  // use nextjs config will break @eslint/config-inspector
  // use `ESLINT_CONFIG_INSPECTOR=true pnpx @eslint/config-inspector` to check the config
  ...process.env.ESLINT_CONFIG_INSPECTOR
    ? []
    // TODO: remove this when upgrade to nextjs 15
    : fixupConfigRules(compat.extends('next')),
  {
    rules: {
      // performance issue, and not used.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/*',
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/out/',
      '**/.next/',
      '**/public/*',
      '**/*.json',
    ],
  },
  {
    // orignal config
    rules: {
      // orignal ts/no-var-requires
      'ts/no-require-imports': 'off',
      'no-console': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react/display-name': 'off',
      'array-callback-return': ['error', {
        allowImplicit: false,
        checkForEach: false,
      }],

      // copy from eslint-config-antfu 0.36.0
      'camelcase': 'off',
      'default-case-last': 'error',

      // antfu use eslint-plugin-perfectionist to replace this
      // will cause big change, so keep the original sort-imports
      'sort-imports': [
        'error',
        {
          ignoreCase: false,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
          allowSeparatedGroups: false,
        },
      ],

      // antfu migrate to eslint-plugin-unused-imports
      'unused-imports/no-unused-vars': 'warn',
      'unused-imports/no-unused-imports': 'warn',
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2025,
        ...globals.node,
        React: 'readable',
        JSX: 'readable',
      },
    },
  },
  storybook.configs['flat/recommended'],
  // need futher research
  {
    rules: {
      // not exist in old version
      'antfu/consistent-list-newline': 'off',
      'node/prefer-global/process': 'off',
      'node/prefer-global/buffer': 'off',
      'node/no-callback-literal': 'off',

      // useful, but big change
      'unicorn/prefer-number-properties': 'warn',
      'unicorn/no-new-array': 'warn',
    },
  },
  // suppress error for `no-undef` rule
  {
    files: GLOB_TESTS,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  tailwind.configs['flat/recommended'],
  {
    rules: {
      // due to 1k lines of tailwind config, these rule have performance issue
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/no-custom-classname': 'off',

      // in the future
      'tailwindcss/classnames-order': 'off',
    },
  },
)
