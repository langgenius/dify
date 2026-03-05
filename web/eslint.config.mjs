// @ts-check
import antfu, { GLOB_TESTS, GLOB_TS, GLOB_TSX } from '@antfu/eslint-config'
import pluginQuery from '@tanstack/eslint-plugin-query'
import tailwindcss from 'eslint-plugin-better-tailwindcss'
import hyoban from 'eslint-plugin-hyoban'
import sonar from 'eslint-plugin-sonarjs'
import storybook from 'eslint-plugin-storybook'
import dify from './eslint-rules/index.js'
import { OVERLAY_MIGRATION_LEGACY_BASE_FILES } from './eslint.constants.mjs'

// Enable Tailwind CSS IntelliSense mode for ESLint runs
// See: tailwind-css-plugin.ts
process.env.TAILWIND_MODE ??= 'ESLINT'

export default antfu(
  {
    react: {
      // This react compiler rules are pretty slow
      // We can wait for https://github.com/Rel1cx/eslint-react/issues/1237
      reactCompiler: false,
      overrides: {
        'react/no-context-provider': 'off',
        'react/no-forward-ref': 'off',
        'react/no-use-context': 'off',

        // prefer react-hooks-extra/no-direct-set-state-in-use-effect
        'react-hooks/set-state-in-effect': 'off',
        'react-hooks-extra/no-direct-set-state-in-use-effect': 'error',
      },
    },
    nextjs: true,
    ignores: ['public', 'types/doc-paths.ts', 'eslint-suppressions.json'],
    typescript: {
      overrides: {
        'ts/consistent-type-definitions': ['error', 'type'],
        'ts/no-explicit-any': 'error',
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
  {
    rules: {
      'node/prefer-global/process': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    settings: {
      'react-x': {
        additionalStateHooks: '/^use\\w*State(?:s)?|useAtom$/u',
      },
    },
  },
  storybook.configs['flat/recommended'],
  ...pluginQuery.configs['flat/recommended'],
  // sonar
  {
    rules: {
      // Manually pick rules that are actually useful and not slow.
      // Or we can just drop the plugin entirely.
    },
    plugins: {
      sonarjs: sonar,
    },
  },
  {
    files: [GLOB_TS, GLOB_TSX],
    ignores: GLOB_TESTS,
    plugins: {
      tailwindcss,
    },
    rules: {
      'tailwindcss/enforce-consistent-class-order': 'error',
      'tailwindcss/no-duplicate-classes': 'error',
      'tailwindcss/no-unnecessary-whitespace': 'error',
      'tailwindcss/no-unknown-classes': 'warn',
    },
  },
  {
    name: 'dify/custom/setup',
    plugins: {
      dify,
      hyoban,
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      'hyoban/prefer-tailwind-icons': ['warn', {
        prefix: 'i-',
        propMappings: {
          size: 'size',
          width: 'w',
          height: 'h',
        },
        libraries: [
          {
            prefix: 'i-custom-',
            source: '^@/app/components/base/icons/src/(?<set>(?:public|vender)(?:/.*)?)$',
            name: '^(?<name>.*)$',
          },
          {
            source: '^@remixicon/react$',
            name: '^(?<set>Ri)(?<name>.+)$',
          },
          {
            source: '^@(?<set>heroicons)/react/24/outline$',
            name: '^(?<name>.*)Icon$',
          },
          {
            source: '^@(?<set>heroicons)/react/24/(?<variant>solid)$',
            name: '^(?<name>.*)Icon$',
          },
          {
            source: '^@(?<set>heroicons)/react/(?<variant>\\d+/(?:solid|outline))$',
            name: '^(?<name>.*)Icon$',
          },
        ],
      }],
    },
  },
  {
    files: ['i18n/**/*.json'],
    rules: {
      'sonarjs/max-lines': 'off',
      'max-lines': 'off',
      'jsonc/sort-keys': 'error',

      'hyoban/i18n-flat-key': 'error',
      'dify/no-extra-keys': 'error',
      'dify/consistent-placeholders': 'error',
    },
  },
  {
    files: ['**/package.json'],
    rules: {
      'hyoban/no-dependency-version-prefix': 'error',
    },
  },
  {
    name: 'dify/base-ui-primitives',
    files: ['app/components/base/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    name: 'dify/overlay-migration',
    files: [GLOB_TS, GLOB_TSX],
    ignores: [
      ...GLOB_TESTS,
      ...OVERLAY_MIGRATION_LEGACY_BASE_FILES,
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/portal-to-follow-elem',
            '**/portal-to-follow-elem/index',
          ],
          message: 'Deprecated: use semantic overlay primitives from @/app/components/base/ui/ instead. See issue #32767.',
        }, {
          group: [
            '**/base/tooltip',
            '**/base/tooltip/index',
          ],
          message: 'Deprecated: use @/app/components/base/ui/tooltip instead. See issue #32767.',
        }, {
          group: [
            '**/base/modal',
            '**/base/modal/index',
            '**/base/modal/modal',
          ],
          message: 'Deprecated: use @/app/components/base/ui/dialog instead. See issue #32767.',
        }, {
          group: [
            '**/base/select',
            '**/base/select/index',
            '**/base/select/custom',
            '**/base/select/pure',
          ],
          message: 'Deprecated: use @/app/components/base/ui/select instead. See issue #32767.',
        }, {
          group: [
            '**/base/confirm',
            '**/base/confirm/index',
          ],
          message: 'Deprecated: use @/app/components/base/ui/alert-dialog instead. See issue #32767.',
        }, {
          group: [
            '**/base/popover',
            '**/base/popover/index',
          ],
          message: 'Deprecated: use @/app/components/base/ui/popover instead. See issue #32767.',
        }, {
          group: [
            '**/base/dropdown',
            '**/base/dropdown/index',
          ],
          message: 'Deprecated: use @/app/components/base/ui/dropdown-menu instead. See issue #32767.',
        }, {
          group: [
            '**/base/dialog',
            '**/base/dialog/index',
          ],
          message: 'Deprecated: use @/app/components/base/ui/dialog instead. See issue #32767.',
        }],
      }],
    },
  },
)
