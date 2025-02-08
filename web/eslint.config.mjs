import antfu from '@antfu/eslint-config'
import js from '@eslint/js'
import tailwind from 'eslint-plugin-tailwindcss'
import ts from 'typescript-eslint'

const antConfig = await antfu({ jsonc: false })
// ...compat.extends("next/core-web-vitals", "next/typescript"),
const eslintConfig = [
  ...antConfig,
  js.configs.recommended,
  ...ts.configs.recommended,
  ...tailwind.configs['flat/recommended'],
  {
    settings: {
      tailwindcss: {
        // These are the default values but feel free to customize
        callees: ['classnames', 'clsx', 'ctl', 'cn'],
        config: 'tailwind.config.js', // returned from `loadConfig()` utility if not provided
        cssFiles: [
          '**/*.css',
          '!**/node_modules',
          '!**/.*',
          '!**/dist',
          '!**/build',
        ],
        cssFilesRefreshRate: 5_000,
        removeDuplicates: true,
        skipClassAttribute: false,
        whitelist: [],
        tags: [], // can be set to e.g. ['tw'] for use in tw`bg-blue`
        classRegex: '^class(Name)?$', // can be modified to support custom attributes. E.g. "^tw$" for `twin.macro`
      },
    },
  },
  {
    ignores: ['node_modules/**', '.next/**', 'build/**', 'dist/**', 'out/**'],
  },
]

export default eslintConfig
