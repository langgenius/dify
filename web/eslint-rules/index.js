import consistentPlaceholders from './rules/consistent-placeholders.js'
import noAsAnyInT from './rules/no-as-any-in-t.js'
import noExtraKeys from './rules/no-extra-keys.js'
import noLegacyNamespacePrefix from './rules/no-legacy-namespace-prefix.js'
import noVersionPrefix from './rules/no-version-prefix.js'
import requireNsOption from './rules/require-ns-option.js'
import validI18nKeys from './rules/valid-i18n-keys.js'

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: 'dify-i18n',
    version: '1.0.0',
  },
  rules: {
    'consistent-placeholders': consistentPlaceholders,
    'no-as-any-in-t': noAsAnyInT,
    'no-extra-keys': noExtraKeys,
    'no-legacy-namespace-prefix': noLegacyNamespacePrefix,
    'no-version-prefix': noVersionPrefix,
    'require-ns-option': requireNsOption,
    'valid-i18n-keys': validI18nKeys,
  },
}

export default plugin
