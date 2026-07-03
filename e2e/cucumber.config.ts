import type { IConfiguration } from '@cucumber/cucumber'
import './scripts/env-register'

const hasCliTags = process.argv.some(arg => arg === '--tags' || arg.startsWith('--tags='))
const defaultTags = process.env.E2E_CUCUMBER_TAGS
  || (hasCliTags ? undefined : 'not @fresh and not @skip and not @preview')

const config = {
  format: [
    'progress-bar',
    'summary',
    'html:./cucumber-report/report.html',
    'json:./cucumber-report/report.json',
  ],
  import: ['./tsx-register.js', 'features/**/*.ts'],
  parallel: 1,
  paths: ['features/**/*.feature'],
  ...(defaultTags ? { tags: defaultTags } : {}),
  timeout: 60_000,
} satisfies Partial<IConfiguration> & {
  timeout: number
}

export default config
