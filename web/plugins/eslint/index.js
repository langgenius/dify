import consistentPlaceholders from './rules/consistent-placeholders.js'
import i18nFlatKey from './rules/i18n-flat-key.js'
import noExtraKeys from './rules/no-extra-keys.js'
import preferTailwindIcons from './rules/prefer-tailwind-icons.js'

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: 'dify',
    version: '1.0.0',
  },
  rules: {
    'consistent-placeholders': consistentPlaceholders,
    'i18n-flat-key': i18nFlatKey,
    'no-extra-keys': noExtraKeys,
    'prefer-tailwind-icons': preferTailwindIcons,
  },
}

export default plugin
