import consistentPlaceholders from './rules/consistent-placeholders.js'
import noExtraKeys from './rules/no-extra-keys.js'

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: 'dify-i18n',
    version: '1.0.0',
  },
  rules: {
    'consistent-placeholders': consistentPlaceholders,
    'no-extra-keys': noExtraKeys,
  },
}

export default plugin
