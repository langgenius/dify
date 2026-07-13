import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url))
const typeCheckedRules =
  tsPlugin.configs['recommended-type-checked']?.rules ??
  tsPlugin.configs.recommendedTypeChecked?.rules ??
  {}

export default [
  {
    ignores: ['dist', 'node_modules', 'scripts'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...typeCheckedRules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
]
