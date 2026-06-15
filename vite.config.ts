import { defineConfig } from 'vite-plus'

const lintFiles = '*.{js,cjs,mjs,jsx,ts,tsx,json,jsonc,json5,md,yml,yaml,toml}'
const formatOnlyFiles = '*.{mdx,css,scss,less,html,vue,svelte}'
const format = 'vp fmt --no-error-on-unmatched-pattern'
const lintFix = 'eslint --fix --pass-on-unpruned-suppressions --no-error-on-unmatched-pattern'
const generatedIgnores = [
  '**/.next/**',
  '**/coverage/**',
  '**/dist/**',
  '**/storybook-static/**',
  'e2e/.auth/**',
  'e2e/cucumber-report/**',
  'web/next/**',
  'web/next-env.d.ts',
]
const eslintIgnoredInputs = ['eslint-suppressions.json', 'web/public/**', 'web/types/doc-paths.ts']
const formatterUnstableInputs = [
  'cli/src/commands/AGENTS.md',
  'web/app/components/develop/template/*.mdx',
]

export default defineConfig({
  staged: {
    [lintFiles]: [format, lintFix],
    [formatOnlyFiles]: format,
  },
  fmt: {
    ignorePatterns: [...generatedIgnores, ...eslintIgnoredInputs, ...formatterUnstableInputs],
    singleQuote: true,
    semi: false,
    sortPackageJson: true,
    sortTailwindcss: {
      functions: ['cn', 'clsx', 'cva', 'tw', 'twMerge'],
      stylesheet: 'web/app/styles/globals.css',
    },
  },
})
