import type { OxlintConfig } from 'vite-plus/lint'
import { lintConfig } from '../../../lint.config.ts'

const webTsxOverride = lintConfig.overrides?.find(
  (override) =>
    override.files?.includes('web/**/*.tsx') &&
    Object.keys(override.rules ?? {}).some((name) => name.startsWith('jsx-a11y/')),
)

const rules = Object.fromEntries(
  Object.entries(webTsxOverride?.rules ?? {}).filter(([name]) => name.startsWith('jsx-a11y/')),
)

if (Object.keys(rules).length === 0)
  throw new Error('Unable to find the Web jsx-a11y rules in the root lint configuration.')

export default {
  categories: {
    correctness: 'off',
  },
  plugins: ['jsx-a11y'],
  rules,
} satisfies OxlintConfig
