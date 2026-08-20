import type { BrowserType, LaunchOptions } from '@playwright/test'

export const launchBrowser = (browserType: BrowserType, options: LaunchOptions) => {
  const endpoint = process.env.PW_TEST_CONNECT_WS_ENDPOINT
  if (!endpoint) return browserType.launch(options)

  return browserType.connect(endpoint, {
    headers: {
      'x-playwright-launch-options': JSON.stringify(options),
    },
  })
}
