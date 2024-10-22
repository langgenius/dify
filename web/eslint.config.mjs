import {
  GLOB_TESTS, combine, javascript, node,
  stylistic, typescript, unicorn,
} from '@antfu/eslint-config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'
import globals from 'globals'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

// storybook plugin not support v9, so add its recommended rules here
const storybook = [
  {
    plugins: ['storybook'],
    files: ['*.stories.@(ts|tsx|js|jsx|mjs|cjs)', '*.story.@(ts|tsx|js|jsx|mjs|cjs)'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'import/no-anonymous-default-export': 'off',
      'storybook/await-interactions': 'error',
      'storybook/context-in-play-function': 'error',
      'storybook/default-exports': 'error',
      'storybook/hierarchy-separator': 'warn',
      'storybook/no-redundant-story-name': 'warn',
      'storybook/prefer-pascal-case': 'warn',
      'storybook/story-exports': 'error',
      'storybook/use-storybook-expect': 'error',
      'storybook/use-storybook-testing-library': 'error',
    },
  },
  {
    plugins: ['storybook'],
    files: ['*.stories.@(ts|tsx|js|jsx|mjs|cjs)', '*.story.@(ts|tsx|js|jsx|mjs|cjs)'],
    rules: {
      'storybook/no-uninstalled-addons': 'error',
    },
  },
]

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
      'curly': ['error', 'multi-line'],
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
  typescript({
    overrides: {
      // useful, but big change
      'ts/no-empty-object-type': 'off',
    },
  }),
  javascript({
    overrides: {
      // handled by unused-imports/no-unused-vars
      'no-unused-vars': 'off',

      // useless
      'no-use-before-define': 'warn',
    },
  }),
  unicorn(),
  node(),
  ...process.env.ESLINT_CONFIG_INSPECTOR
    ? []
    // TODO: remove this when upgrade to nextjs 15
    : [compat.extends('next')],
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
      // from old version of antfu/eslint-config
      // typescript will handle this, see https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      'no-undef': 'off',

      'ts/consistent-type-definitions': ['error', 'type'],
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
      'curly': ['error', 'multi-or-nest', 'consistent'],
      'default-case-last': 'error',
      'dot-notation': ['error', { allowKeywords: true }],
      'new-cap': ['error', { newIsCap: true, capIsNew: false, properties: true }],

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
  storybook,
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
)
