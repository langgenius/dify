import { defineConfig, importESLintRules } from '@tsslint/config'

// npx tsslint-docgen

export default defineConfig({
  rules: {
    ...await importESLintRules({
      'react-x/no-leaked-conditional-rendering': 'warn',
    }),
  },
})
