import { stylistic, typescript, combine, javascript, GLOB_TESTS, GLOB_JSX, GLOB_TSX } from '@antfu/eslint-config'
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
      }
  },
  {
    plugins: ['storybook'],
    files: ['*.stories.@(ts|tsx|js|jsx|mjs|cjs)', '*.story.@(ts|tsx|js|jsx|mjs|cjs)'],
      rules: {
        'storybook/no-uninstalled-addons': 'error',
      }
  }
]

export default combine(
  stylistic({
    lessOpinionated: true,
    // original @antfu/eslint-config does not support jsx
    jsx: false,
    overrides: {
      "style/indent": "off",

      // these options does not exist in old version
      "style/indent-binary-ops": "off",
      "style/multiline-ternary": "off",

      // big change
      "style/quote-props": "off",
      "style/member-delimiter-style": "off",
      "style/quotes": "off",
      "style/comma-dangle": "off",
    }
  }),
  typescript({
    overrides: {
      // useful, but big change
      "ts/no-empty-object-type": "off",
    }
  }),
  javascript({
    overrides: {
      'no-unused-vars': 'off',
      'no-use-before-define': 'off'
    }
  }),
  // TODO: remove this when upgrade to nextjs 15
  compat.extends('next'),
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
    ]
  },
  {
    // orignal config
    rules: {
      'ts/consistent-type-definitions': ['error', 'type'],
      'ts/no-require-imports': 'off',
      "no-console": 'off',
      "react-hooks/exhaustive-deps": "warn",
      "react/display-name": "off",
      "curly": "off",
      "unused-imports/no-unused-vars": "warn",
      "unused-imports/no-unused-imports": "warn",
      "no-undef": "error"
    }
  },
  storybook,
  // need futher research
  {
    rules: {
      // not exist in old version
      "antfu/consistent-list-newline": "off",

      // useful, but big change
      "no-useless-constructor": "off",
      "no-undef": "warn"
    }
  },
  // suppress error for `no-undef` rule
  {
    files: GLOB_TESTS,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
        ...globals.jest
      },
    },
  },
  {
    files: [
      GLOB_JSX,
      GLOB_TSX,
      '**/hooks/*'
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2025,
        ...globals.node,
        'React': 'readable',
        'JSX': 'readable',
      }
    }
  }
)
