import type { DifyWorld, MarketplacePerformanceMetrics } from '../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { e2eBrowser } from '../../test-env'

// Baseline against the frozen marketplace fixture stub: the first card lands
// around 2.3-2.6s under Fast 4G + 4x CPU throttling (dominated by the ~630KB
// server-rendered HTML), so 4s guards regressions with headroom for slower CI
// runners. The stub serves a frozen recommend banner, so the measured first
// screen also includes the trending carousel and its background image.
const FIRST_CARD_BUDGET_MS = 4_000
const DOCUMENT_ELEMENT_BUDGET = 2_000
// Hydrating the server-rendered list peaks around ~220ms on shared CI runners
// under 4x CPU throttling; 300ms still flags pathological main-thread work.
const LONG_TASK_BUDGET_MS = 300
const FAST_4G_DOWNLOAD_BYTES_PER_SECOND = 4_000_000 / 8
const FAST_4G_UPLOAD_BYTES_PER_SECOND = 3_000_000 / 8

type PerformanceWindow = Window & {
  __marketplaceLongTaskDurations?: number[]
}

When(
  'I measure the embedded Marketplace under Fast 4G and 4x CPU throttling',
  async function (this: DifyWorld) {
    if (e2eBrowser !== 'chromium')
      throw new Error('The Marketplace performance benchmark requires E2E_BROWSER=chromium.')
    if (!this.context)
      throw new Error('Playwright context has not been initialized for this scenario.')

    const page = this.getPage()
    const cdpSession = await this.context.newCDPSession(page)

    try {
      await page.addInitScript(() => {
        const performanceWindow = window as PerformanceWindow
        performanceWindow.__marketplaceLongTaskDurations = []

        if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return

        const observer = new PerformanceObserver((entries) => {
          performanceWindow.__marketplaceLongTaskDurations!.push(
            ...entries.getEntries().map((entry) => entry.duration),
          )
        })
        observer.observe({ type: 'longtask', buffered: true })
      })

      await cdpSession.send('Network.enable')
      await cdpSession.send('Network.emulateNetworkConditions', {
        connectionType: 'cellular4g',
        downloadThroughput: FAST_4G_DOWNLOAD_BYTES_PER_SECOND,
        latency: 60,
        offline: false,
        uploadThroughput: FAST_4G_UPLOAD_BYTES_PER_SECOND,
      })
      await cdpSession.send('Emulation.setCPUThrottlingRate', { rate: 4 })

      await page.goto('/marketplace', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-marketplace-card]').first().waitFor({
        state: 'visible',
        timeout: 30_000,
      })
      const firstCardVisibleMs = await page.evaluate(() => performance.now())

      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )

      this.marketplacePerformanceMetrics = await page.evaluate(
        (visibleMs): MarketplacePerformanceMetrics => {
          const performanceWindow = window as PerformanceWindow
          const longTaskDurations = performanceWindow.__marketplaceLongTaskDurations ?? []

          return {
            firstCardVisibleMs: visibleMs,
            documentElementCount: document.querySelectorAll('*').length,
            longestTaskMs: Math.max(0, ...longTaskDurations),
          }
        },
        firstCardVisibleMs,
      )
    } finally {
      await cdpSession.detach()
    }
  },
)

Then(
  'the embedded Marketplace should meet its initial rendering budgets',
  async function (this: DifyWorld) {
    const metrics = this.marketplacePerformanceMetrics
    if (!metrics) throw new Error('Marketplace performance metrics were not captured.')

    this.attach(JSON.stringify(metrics, null, 2), 'application/json')

    expect(metrics.firstCardVisibleMs).toBeLessThanOrEqual(FIRST_CARD_BUDGET_MS)
    expect(metrics.documentElementCount).toBeLessThanOrEqual(DOCUMENT_ELEMENT_BUDGET)
    expect(metrics.longestTaskMs).toBeLessThanOrEqual(LONG_TASK_BUDGET_MS)
  },
)
