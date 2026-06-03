export const defaultBaseURL = 'http://127.0.0.1:3000'
export const defaultApiURL = 'http://127.0.0.1:5001'
export const defaultApiV2URL = 'http://127.0.0.1:5004/api/v2'
export const defaultLocale = 'en-US'

export const baseURL = process.env.E2E_BASE_URL || defaultBaseURL
export const apiURL = process.env.E2E_API_URL || defaultApiURL
export const apiV2URL = process.env.E2E_API_V2_PREFIX || defaultApiV2URL

export const cucumberHeadless = process.env.CUCUMBER_HEADLESS !== '0'
export const cucumberSlowMo = Number(process.env.E2E_SLOW_MO || 0)
export const reuseExistingWebServer = process.env.E2E_REUSE_WEB_SERVER
  ? process.env.E2E_REUSE_WEB_SERVER !== '0'
  : !process.env.CI
