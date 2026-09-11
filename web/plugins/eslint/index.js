import consistentPlaceholders from './rules/consistent-placeholders.js'
import i18nFlatKey from './rules/i18n-flat-key.js'
import noExtraKeys from './rules/no-extra-keys.js'
import noFileWideDisable from './rules/no-file-wide-disable.js'
import preferTailwindIcons from './rules/prefer-tailwind-icons.js'
import requireDisableDirectiveDescription from './rules/require-disable-directive-description.js'
import requireTitleForTruncatedText from './rules/require-title-for-truncated-text.js'

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
    'no-file-wide-disable': noFileWideDisable,
    'prefer-tailwind-icons': preferTailwindIcons,
    'require-disable-directive-description': requireDisableDirectiveDescription,
    'require-title-for-truncated-text': requireTitleForTruncatedText,
  },
}

export default plugin
