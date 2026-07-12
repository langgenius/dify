import { defineConfig } from 'vite-plus'

const codeFiles = '*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'
const eslintOnlyFiles = '*.{json,jsonc,json5,md,yml,yaml,toml}'
const formatOnlyFiles = '*.{mdx,css,scss,less,html,vue,svelte,gql,graphql,hbs,handlebars}'
const oxlintFix = 'vp lint --fix --no-error-on-unmatched-pattern'
const eslintFix = 'eslint --fix --pass-on-unpruned-suppressions --no-error-on-unmatched-pattern'
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
  'web/next/**',
  'web/next-env.d.ts',
  'web/public/embed.min.js',
  'web/public/pdf.worker.min.mjs',
  'web/public/vs/**',
]

const lintIgnores = [
  ...nonFrontendIgnores,
  ...generatedIgnores,
  '.claude/**',
  'cli/**',
  'packages/dify-ui/**',
  'sdks/**',
  'web/public/**',
  'web/types/doc-paths.ts',
]

const formatterUnstableInputs = ['web/app/components/develop/template/*.mdx']

export default defineConfig({
  staged: {
    [codeFiles]: [oxlintFix, eslintFix, format],
    [eslintOnlyFiles]: [eslintFix, format],
    [formatOnlyFiles]: format,
  },
  lint: {
    categories: {
      correctness: 'off',
    },
    ignorePatterns: lintIgnores,
    plugins: ['eslint', 'react', 'unicorn'],
    rules: {
      'no-unmodified-loop-condition': 'error',
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          fix: {
            imports: 'safe-fix',
            variables: 'off',
          },
          ignoreRestSiblings: true,
          vars: 'all',
          varsIgnorePattern: '^_',
        },
      ],
      'react/rules-of-hooks': 'error',
      'unicorn/prefer-dom-node-text-content': 'error',
      'unicorn/prefer-includes': 'error',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-string-starts-ends-with': 'error',
    },
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
