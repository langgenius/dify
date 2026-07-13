import { defineConfig } from 'vite-plus'
import { lintConfig } from './lint.config'

const lintFiles = '*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'
const eslintFiles = '*.{json,jsonc,json5,md,yml,yaml,toml}'
const formatOnlyFiles = '*.{mdx,css,scss,less,html,vue,svelte,gql,graphql,hbs,handlebars}'
const lintFix = 'vp lint --fix --no-error-on-unmatched-pattern'
const eslintFix =
  'eslint --fix --pass-on-unpruned-suppressions --no-error-on-unmatched-pattern --no-warn-ignored'
const format = 'vp fmt --no-error-on-unmatched-pattern'

const nonFrontendIgnores = [
  '.agents/**',
  '.devcontainer/**',
  '.github/**',
  '/*.md',
  'api/**',
  'codecov.yml',
  'depot.json',
  'dify-agent/**',
  'docker/**',
  'docs/**',
  'scripts/**',
  'sdks/php-client/**',
  'sdks/python-client/**',
]

const generatedIgnores = [
  '**/.next/**',
  '**/.vinext/**',
  '**/coverage/**',
  '**/dist/**',
  '**/storybook-static/**',
  'e2e/.auth/**',
  'e2e/cucumber-report/**',
  'eslint-suppressions.json',
  'oxlint-suppressions.json',
  'web/next/**',
  'web/next-env.d.ts',
  'web/public/embed.min.js',
  'web/public/pdf.worker.min.mjs',
  'web/public/vs/**',
]

const formatterUnstableInputs = ['web/app/components/develop/template/*.mdx']

export default defineConfig({
  lint: lintConfig,
  staged: {
    [lintFiles]: [lintFix, eslintFix, format],
    [eslintFiles]: [eslintFix, format],
    [formatOnlyFiles]: format,
  },
  fmt: {
    ignorePatterns: [...nonFrontendIgnores, ...generatedIgnores, ...formatterUnstableInputs],
    singleQuote: true,
    semi: false,
    sortImports: {
      groups: [
        'type-import',
        ['type-parent', 'type-sibling', 'type-index', 'type-internal', 'type-subpath'],
        'value-builtin',
        'value-external',
        ['value-internal', 'value-subpath'],
        ['value-parent', 'value-sibling', 'value-index'],
        ['side_effect_style', 'side_effect'],
        'unknown',
      ],
      newlinesBetween: false,
      sortSideEffects: false,
    },
    sortPackageJson: true,
    sortTailwindcss: {
      functions: ['cn', 'clsx', 'cva', 'tw', 'twMerge'],
      preserveDuplicates: true,
      stylesheet: 'web/app/styles/globals.css',
    },
  },
})
