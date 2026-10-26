import type { ESLint } from 'eslint'
import consistentPlaceholders from './rules/consistent-placeholders.ts'
import i18nFlatKey from './rules/i18n-flat-key.ts'
import noExtraKeys from './rules/no-extra-keys.ts'
import noFileWideDisable from './rules/no-file-wide-disable.ts'
import preferTailwindIcons from './rules/prefer-tailwind-icons.ts'
import requireDisableDirectiveDescription from './rules/require-disable-directive-description.ts'
import requireI18nNamespace from './rules/require-i18n-namespace.ts'
import requireTFunctionNamespace from './rules/require-t-function-namespace.ts'
import requireTitleForTruncatedText from './rules/require-title-for-truncated-text.ts'

const plugin: ESLint.Plugin = {
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
    'require-i18n-namespace': requireI18nNamespace,
    'require-t-function-namespace': requireTFunctionNamespace,
    'require-title-for-truncated-text': requireTitleForTruncatedText,
  },
}

export default plugin
