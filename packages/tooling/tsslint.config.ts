import { defineConfig, importESLintRules } from '@tsslint/config'
import noUnnecessaryTypeAssertion from './plugins/tsslint/no-unnecessary-type-assertion.ts'

// Migration-only rules stay out of the regular `lint:tss` run; see `migrate:type-assertions`.
const enableTypeAssertionMigration = process.env.TSSLINT_TYPE_ASSERTION_MIGRATION === 'true'

// Run `npx tsslint-docgen` to generate documentation for the configured rules.

export default defineConfig({
  rules: {
    ...(await importESLintRules({
      'react-x/no-leaked-conditional-rendering': 'error',
    })),
    ...(enableTypeAssertionMigration
      ? { dify: { 'no-unnecessary-type-assertion': noUnnecessaryTypeAssertion } }
      : {}),
  },
})
