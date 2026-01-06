// @ts-check
import antfu from '@antfu/eslint-config'
import pluginQuery from '@tanstack/eslint-plugin-query'
import sonar from 'eslint-plugin-sonarjs'
import storybook from 'eslint-plugin-storybook'
import tailwind from 'eslint-plugin-tailwindcss'
import difyI18n from './eslint-rules/index.js'

export default antfu(
  {
    react: {
      overrides: {
        'react/no-context-provider': 'off',
        'react/no-forward-ref': 'off',
        'react/no-use-context': 'off',
        'react/prefer-namespace-import': 'error',

        // React Compiler rules
        // Set to warn for gradual adoption
        'react-hooks/config': 'warn',
        'react-hooks/error-boundaries': 'warn',
        'react-hooks/component-hook-factories': 'warn',
        'react-hooks/gating': 'warn',
        'react-hooks/globals': 'warn',
        'react-hooks/immutability': 'warn',
        'react-hooks/preserve-manual-memoization': 'warn',
        'react-hooks/purity': 'warn',
        'react-hooks/refs': 'warn',
        'react-hooks/set-state-in-effect': 'warn',
        'react-hooks/set-state-in-render': 'warn',
        'react-hooks/static-components': 'warn',
        'react-hooks/unsupported-syntax': 'warn',
        'react-hooks/use-memo': 'warn',
        'react-hooks/incompatible-library': 'warn',
      },
    },
    nextjs: true,
    ignores: ['public'],
    typescript: {
      overrides: {
        'ts/consistent-type-definitions': ['error', 'type'],
        'ts/no-explicit-any': 'warn',
      },
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
  // downgrade some rules from error to warn for gradual adoption
  // we should fix these in following pull requests
  {
    // @keep-sorted
    rules: {
      'next/inline-script-id': 'warn',
      'no-console': 'warn',
      'no-irregular-whitespace': 'warn',
      'node/prefer-global/buffer': 'warn',
      'node/prefer-global/process': 'warn',
      'react/no-create-ref': 'warn',
      'react/no-missing-key': 'warn',
      'react/no-nested-component-definitions': 'warn',
      'regexp/no-dupe-disjunctions': 'warn',
      'regexp/no-super-linear-backtracking': 'warn',
      'regexp/no-unused-capturing-group': 'warn',
      'regexp/no-useless-assertions': 'warn',
      'regexp/no-useless-quantifier': 'warn',
      'style/multiline-ternary': 'warn',
      'test/no-identical-title': 'warn',
      'test/prefer-hooks-in-order': 'warn',
      'ts/no-empty-object-type': 'warn',
      'unicorn/prefer-number-properties': 'warn',
      'unused-imports/no-unused-vars': 'warn',
    },
  },
  storybook.configs['flat/recommended'],
  ...pluginQuery.configs['flat/recommended'],
  // sonar
  {
    rules: {
      ...sonar.configs.recommended.rules,
      // code complexity
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-nested-functions': 'warn',
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/nested-control-flow': 'warn', // 3 levels of nesting
      'sonarjs/no-small-switch': 'off',
      'sonarjs/no-nested-template-literals': 'warn',
      'sonarjs/redundant-type-aliases': 'off',
      'sonarjs/regex-complexity': 'warn',
      // maintainability
      'sonarjs/no-ignored-exceptions': 'off',
      'sonarjs/no-commented-code': 'warn',
      'sonarjs/no-unused-vars': 'warn',
      'sonarjs/prefer-single-boolean-return': 'warn',
      'sonarjs/duplicates-in-character-class': 'off',
      'sonarjs/single-char-in-character-classes': 'off',
      'sonarjs/anchor-precedence': 'warn',
      'sonarjs/updated-loop-counter': 'off',
      'sonarjs/no-dead-store': 'error',
      'sonarjs/no-duplicated-branches': 'warn',
      'sonarjs/max-lines': 'warn', // max 1000 lines
      'sonarjs/no-variable-usage-before-declaration': 'error',
      // security

      'sonarjs/no-hardcoded-passwords': 'off', // detect the wrong code that is not password.
      'sonarjs/no-hardcoded-secrets': 'off',
      'sonarjs/pseudo-random': 'off',
      // performance
      'sonarjs/slow-regex': 'warn',
      // others
      'sonarjs/todo-tag': 'warn',
      'sonarjs/table-header': 'off',

      // new from this update
      'sonarjs/unused-import': 'off',
      'sonarjs/use-type-alias': 'warn',
      'sonarjs/single-character-alternation': 'warn',
      'sonarjs/no-os-command-from-path': 'warn',
      'sonarjs/class-name': 'off',
      'sonarjs/no-redundant-jump': 'warn',
    },
    plugins: {
      sonarjs: sonar,
    },
  },
  tailwind.configs['flat/recommended'],
  {
    settings: {
      tailwindcss: {
        // These are the default values but feel free to customize
        callees: ['classnames', 'clsx', 'ctl', 'cn', 'classNames'],
        config: 'tailwind.config.js', // returned from `loadConfig()` utility if not provided
        cssFiles: [
          '**/*.css',
          '!**/node_modules',
          '!**/.*',
          '!**/dist',
          '!**/build',
          '!**/.storybook',
          '!**/.next',
          '!**/.public',
        ],
        cssFilesRefreshRate: 5_000,
        removeDuplicates: true,
        skipClassAttribute: false,
        whitelist: [],
        tags: [], // can be set to e.g. ['tw'] for use in tw`bg-blue`
        classRegex: '^class(Name)?$', // can be modified to support custom attributes. E.g. "^tw$" for `twin.macro`
      },
    },
    rules: {
      // due to 1k lines of tailwind config, these rule have performance issue
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',

      'tailwindcss/no-arbitrary-value': 'off',
      'tailwindcss/classnames-order': 'warn',
      'tailwindcss/enforces-negative-arbitrary-values': 'warn',
      'tailwindcss/migration-from-tailwind-2': 'warn',
    },
  },
  // dify i18n namespace migration
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['eslint-rules/**', 'i18n/**', 'i18n-config/**'],
    plugins: {
      'dify-i18n': difyI18n,
    },
    rules: {
      // 'dify-i18n/no-as-any-in-t': ['error', { mode: 'all' }],
      'dify-i18n/no-as-any-in-t': 'error',
      // 'dify-i18n/no-legacy-namespace-prefix': 'error',
      // 'dify-i18n/require-ns-option': 'error',
    },
  },
  // i18n JSON validation rules
  {
    files: ['i18n/**/*.json'],
    plugins: {
      'dify-i18n': difyI18n,
    },
    rules: {
      'sonarjs/max-lines': 'off',
      'max-lines': 'off',
      'jsonc/sort-keys': 'error',

      'dify-i18n/valid-i18n-keys': 'error',
      'dify-i18n/no-extra-keys': 'error',
    },
  },
)
