import noAsAnyInT from './rules/no-as-any-in-t.js'
import noLegacyNamespacePrefix from './rules/no-legacy-namespace-prefix.js'
import requireNsOption from './rules/require-ns-option.js'

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: 'dify-i18n',
    version: '1.0.0',
  },
  rules: {
    'no-as-any-in-t': noAsAnyInT,
    'no-legacy-namespace-prefix': noLegacyNamespacePrefix,
    'require-ns-option': requireNsOption,
  },
}

export default plugin
