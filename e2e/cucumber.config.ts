import type { IConfiguration } from '@cucumber/cucumber'
import './scripts/env-register'

const hasCliTags = process.argv.some((arg) => arg === '--tags' || arg.startsWith('--tags='))
const defaultNonExternalTags =
  'not @axe and not @prepared and not @external-model and not @external-tool'
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
  import: ['./tsx-register.js', 'features/**/*.ts'],
  paths: ['features/**/*.feature'],
  tags,
  timeout: 60_000,
} satisfies Partial<IConfiguration> & {
  timeout: number
}

export default config
