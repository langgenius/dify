import type { OxlintConfig } from 'vite-plus/lint'
import { webJsxA11yRules } from '../../../lint.config.ts'

export default {
  categories: {
    correctness: 'off',
  },
  plugins: ['jsx-a11y'],
  rules: webJsxA11yRules,
} satisfies OxlintConfig
