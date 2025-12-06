import {
  GLOB_TESTS, combine, javascript, node,
  stylistic, typescript, unicorn,
} from '@antfu/eslint-config'
import globals from 'globals'
import storybook from 'eslint-plugin-storybook'
// import { fixupConfigRules } from '@eslint/compat'
import tailwind from 'eslint-plugin-tailwindcss'
import reactHooks from 'eslint-plugin-react-hooks'
import sonar from 'eslint-plugin-sonarjs'
import oxlint from 'eslint-plugin-oxlint'
import next from '@next/eslint-plugin-next'

// import reactRefresh from 'eslint-plugin-react-refresh'

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
  // Next.js configuration
  {
    plugins: {
      '@next/next': next,
    },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      // performance issue, and not used.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    ignores: [
      'storybook-static/**',
      '**/node_modules/*',
      '**/dist/',
      '**/build/',
      '**/out/',
      '**/.next/',
      '**/public/*',
      '**/*.json',
      '**/*.js',
    ],
  },
  {
    // orignal config
    rules: {
      // orignal ts/no-var-requires
      'ts/no-require-imports': 'off',
      'no-console': 'off',
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

      // We use `import { noop } from 'lodash-es'` across `web` project
      'no-empty-function': 'error',
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
  // reactRefresh.configs.recommended,
  {
    rules: reactHooks.configs.recommended.rules,
    plugins: {
      'react-hooks': reactHooks,
    },
  },
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
    },
    plugins: {
      sonarjs: sonar,
    },
  },
  // need further research
  {
    rules: {
      // not exist in old version
      'antfu/consistent-list-newline': 'off',
      'node/prefer-global/process': 'off',
      'node/prefer-global/buffer': 'off',
      'node/no-callback-literal': 'off',
      'eslint-comments/no-unused-disable': 'off',
      'tailwindcss/no-arbitrary-value': 'off',
      'tailwindcss/classnames-order': 'off',
      'style/indent': ['error', 2, {
        SwitchCase: 1,
        ignoreComments: true,

      }],
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
  ...oxlint.buildFromOxlintConfigFile('./.oxlintrc.json'),
)
