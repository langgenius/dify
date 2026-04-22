import type { IConfiguration } from '@cucumber/cucumber'

const config = {
  format: [
    'progress-bar',
    'summary',
    'html:./cucumber-report/report.html',
    'json:./cucumber-report/report.json',
  ],
  import: ['features/**/*.ts'],
  parallel: 1,
  paths: ['features/**/*.feature'],
  tags: process.env.E2E_CUCUMBER_TAGS || 'not @fresh and not @skip',
  timeout: 60_000,
} satisfies Partial<IConfiguration> & {
  timeout: number
}

export default config
