import type { IConfiguration } from '@cucumber/cucumber'
import './scripts/env-register.ts'

const hasCliTags = process.argv.some((arg) => arg === '--tags' || arg.startsWith('--tags='))
const defaultNonExternalTags =
  'not @axe and not @prepared and not @external-model and not @external-tool and not @cloud-catalog-runtime'
const selectedTags =
  process.env.E2E_CUCUMBER_TAGS || (hasCliTags ? undefined : defaultNonExternalTags)
const tags = selectedTags ? `(${selectedTags}) and not @skip` : 'not @skip'

const config = {
  format: [
    'progress-bar',
    'summary',
    'html:./cucumber-report/report.html',
    'message:./cucumber-report/report.ndjson',
  ],
  import: ['features/**/*.ts'],
  paths: ['features/**/*.feature'],
  tags,
  timeout: 60_000,
} satisfies Partial<IConfiguration> & {
  timeout: number
}

export default config
