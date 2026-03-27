/**
 * @type {import('@cucumber/cucumber').IConfiguration}
 */
export default {
  format: [
    'progress-bar',
    'summary',
    'html:./cucumber-report/report.html',
    'json:./cucumber-report/report.json',
  ],
  parallel: 1,
  paths: ['features/**/*.feature'],
  publishQuiet: true,
  require: ['features/**/*.ts'],
  requireModule: ['tsx/cjs'],
  tags: process.env.E2E_CUCUMBER_TAGS || 'not @fresh and not @skip',
  timeout: 60_000,
}
