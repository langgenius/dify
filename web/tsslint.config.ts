import { defineConfig, importESLintRules } from '@tsslint/config'

// Run `npx tsslint-docgen` to generate documentation for the configured rules.

export default defineConfig({
  rules: {
    ...await importESLintRules({
      'react-x/no-leaked-conditional-rendering': 'error',
    }),
  },
})
