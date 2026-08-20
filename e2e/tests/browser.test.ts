import type { BrowserType } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { launchBrowser } from '../support/browser'

describe('launchBrowser', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('forwards launch options to the remote browser server', async () => {
    const connect = vi.fn()
    const launch = vi.fn()
    const browserType = { connect, launch } as unknown as BrowserType
    const options = { headless: true, slowMo: 10 }
    vi.stubEnv('PW_TEST_CONNECT_WS_ENDPOINT', 'ws://127.0.0.1:3001/')

    await launchBrowser(browserType, options)

    expect(connect).toHaveBeenCalledWith('ws://127.0.0.1:3001/', {
      headers: {
        'x-playwright-launch-options': JSON.stringify(options),
      },
    })
    expect(launch).not.toHaveBeenCalled()
  })
})
