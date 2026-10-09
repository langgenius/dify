import type { OxlintConfig } from 'vite-plus/lint'
import { jsxA11yRules } from '../../../lint.config.ts'

export default {
  categories: {
    correctness: 'off',
  },
  plugins: ['jsx-a11y'],
  rules: jsxA11yRules,
} satisfies OxlintConfig
