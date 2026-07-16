export const defaultBaseURL = 'http://127.0.0.1:3000'
export const defaultApiURL = 'http://127.0.0.1:5001'
export const defaultLocale = 'en-US'

export const supportedE2EBrowsers = ['chromium', 'webkit'] as const
export type E2EBrowser = (typeof supportedE2EBrowsers)[number]

export const resolveE2EBrowser = (value: string | undefined): E2EBrowser => {
  if (value === undefined) return 'chromium'
  if (supportedE2EBrowsers.some((browser) => browser === value)) return value as E2EBrowser

  throw new Error(`Unsupported E2E browser "${value}".`)
}

export const baseURL = process.env.E2E_BASE_URL || defaultBaseURL
export const apiURL = process.env.E2E_API_URL || defaultApiURL

export const cucumberHeadless = process.env.CUCUMBER_HEADLESS !== '0'
export const cucumberSlowMo = Number(process.env.E2E_SLOW_MO || 0)
export const e2eBrowser = resolveE2EBrowser(process.env.E2E_BROWSER)
export const reuseExistingWebServer = process.env.E2E_REUSE_WEB_SERVER
  ? process.env.E2E_REUSE_WEB_SERVER !== '0'
  : !process.env.CI
