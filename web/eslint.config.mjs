import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

const ignores = [
  '**/node_modules/*',
  '**/node_modules/',
  '**/dist/',
  '**/build/',
  '**/out/',
  '**/.next/',
  // TODO: remove this
  '**/*.json',
  '**/*.md',
]

const backup = {
  rules: {
    '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
    '@typescript-eslint/no-var-requires': 'off',
    'no-console': 'off',
    'indent': 'off',

    '@typescript-eslint/indent': ['error', 2, {
      SwitchCase: 1,
      flatTernaryExpressions: false,

      ignoredNodes: [
        'PropertyDefinition[decorators]',
        'TSUnionType',
        'FunctionExpression[params]:has(Identifier[decorators])',
      ],
    }],

    'react-hooks/exhaustive-deps': 'warn',
    'react/display-name': 'warn',
  },
}

const config = [
  { ignores },
  ...compat.extends('next', '@antfu', 'plugin:storybook/recommended'),
  backup,
]

export default config
