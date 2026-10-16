import { defineConfig, importESLintRules } from '@tsslint/config'
import noUnnecessaryTypeAssertion from './plugins/tsslint/no-unnecessary-type-assertion.ts'

// Run `npx tsslint-docgen` to generate documentation for the configured rules.

export default defineConfig({
  rules: {
    ...(await importESLintRules({
      'react-x/no-leaked-conditional-rendering': 'error',
    })),
    dify: {
      'no-unnecessary-type-assertion': noUnnecessaryTypeAssertion,
    },
  },
})
