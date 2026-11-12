import type { Locator } from 'vite-plus/test/browser'
import { Dialog, DialogPortal } from '@langgenius/dify-ui/dialog'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { cdp, page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import billing from '@/i18n/locales/en-US/billing.json'
import common from '@/i18n/locales/en-US/common.json'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { PricingDialogContent } from '../dialog-content'

vi.unmock('react-i18next')

async function openPricing() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { billing, common } },
  })
  await page.viewport(1512, 1000)
  const { queryClient, wrapper: Provider } = createConsoleQueryWrapper()
  seedFeatures(queryClient)
  await render(
    <I18nextProvider i18n={i18n}>
      <Provider>
        <Dialog defaultOpen>
          <DialogPortal>
            <PricingDialogContent />
          </DialogPortal>
        </Dialog>
      </Provider>
    </I18nextProvider>,
  )
}

it('reanchors a pinned explanation to a hovered feature in the same or another plan', async () => {
  await openPricing()
  const runs = page.getByRole('button', { name: '500 app runs / month' })
  const title = page.getByRole('heading', { name: 'Dify Cloud' })
  for (const [label, explanation] of [
    ['200 AI credits total', billing['pricing.credits.basic']],
    [billing['pricing.advancedModels'], billing['pricing.credits.advanced']],
  ] as const) {
    const next = page.getByRole('button', { name: label }).first()
    await runs.click()
    await title.hover()
    // A pinned popup must outlast the Infotip's 200 ms hover-close delay.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect.element(page.getByText(billing['pricing.runs.tooltip'])).toBeVisible()
    await next.hover()
    const popup = page.getByRole('dialog', { name: label })
    await expect.element(popup).toHaveTextContent(explanation)
    expect(popup.element().getAttribute('aria-labelledby')).toBe(
      next.element().getAttribute('aria-labelledby'),
    )
    await expect.element(page.getByText(billing['pricing.runs.tooltip'])).not.toBeInTheDocument()
    await expect
      .poll(() => {
        const anchor = next.element().getBoundingClientRect()
        const surface = popup.element().getBoundingClientRect()
        const horizontalError = Math.abs(
          surface.left + surface.width / 2 - anchor.left - anchor.width / 2,
        )
        const verticalError = Math.abs(surface.bottom + 8 - anchor.top)
        return Math.max(horizontalError, verticalError)
      })
      .toBeLessThan(2)
    await popup.hover()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect.element(popup).toBeVisible()
    await title.hover()
    await expect.element(popup).not.toBeInTheDocument()
    await next.hover()
    await expect.element(popup).toBeVisible()
    await next.click()
    await title.hover()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect.element(popup).toBeVisible()
    await next.click()
    await expect.element(popup).not.toBeInTheDocument()
  }
})

it('opens a feature by keyboard and restores focus on Escape', async () => {
  await openPricing()
  const runs = page.getByRole('button', { name: '500 app runs / month' })
  runs.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText(billing['pricing.runs.tooltip'])).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByText(billing['pricing.runs.tooltip'])).not.toBeInTheDocument()
  await expect.element(runs).toHaveFocus()
})

async function tap(target: Locator) {
  target.element().scrollIntoView({ block: 'center', behavior: 'instant' })
  const bounds = target.element().getBoundingClientRect()
  await cdp().send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
  })
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

it('keeps a tapped explanation readable until an outside tap', async () => {
  await openPricing()
  await page.viewport(390, 844)
  const runs = page.getByRole('button', { name: '500 app runs / month' })
  await tap(runs)
  await expect.element(page.getByText(billing['pricing.runs.tooltip'])).toBeVisible()
  await tap(page.getByRole('heading', { name: 'Dify Cloud' }))
  await expect.element(page.getByText(billing['pricing.runs.tooltip'])).not.toBeInTheDocument()
})
