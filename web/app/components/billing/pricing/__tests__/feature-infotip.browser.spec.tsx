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

// A pinned popup must outlast the Infotip's 200 ms hover-close delay, so advance past that window.
async function outlastHoverCloseDelay() {
  await vi.advanceTimersByTimeAsync(300)
}

// Base UI keeps a hover-opened popup open on clicks within 500 ms, so pin and unpin after that window.
async function outlastPatientClickThreshold() {
  await vi.advanceTimersByTimeAsync(500)
}

it('reanchors a pinned explanation to a hovered feature in the same or another plan', async () => {
  // boundary: advance only the hover delays; pointer events and positioning stay real.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  await openPricing()
  const runs = page.getByRole('button', { name: '500 app runs / month' })
  const title = page.getByRole('heading', { name: 'Dify Cloud' })
  for (const [label, explanation] of [
    ['200 AI credits total (basic models)', billing['pricing.credits.basic']],
    [
      '5,000 AI credits/month (basic and selected advanced models)',
      billing['pricing.credits.advanced'],
    ],
  ] as const) {
    const next = page.getByRole('button', { name: label }).first()
    await runs.click()
    await title.hover()
    await outlastHoverCloseDelay()
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
    await outlastHoverCloseDelay()
    await expect.element(popup).toBeVisible()
    await title.hover()
    await outlastHoverCloseDelay()
    await expect.element(popup).not.toBeInTheDocument()
    await next.hover()
    await expect.element(popup).toBeVisible()
    await outlastPatientClickThreshold()
    await next.click()
    await title.hover()
    await outlastHoverCloseDelay()
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

it('lists every published entitlement per plan and explains only the marked ones', async () => {
  await openPricing()
  const lists = await page.getByRole('list').all()
  const plans = lists.filter((list) => list.element().closest('[role="dialog"]'))
  const rendered = plans.map((list) =>
    [...list.element().querySelectorAll('li')].map(
      (item) => `${item.textContent?.trim()}${item.querySelector('button') ? ' ⓘ' : ''}`,
    ),
  )
  expect(rendered).toEqual([
    [
      '500 app runs / month ⓘ',
      '200 AI credits total (basic models) ⓘ',
      '1 team member',
      'Up to 5 apps',
      'Up to 30 days of app logs ⓘ',
      '50 knowledge documents',
      '50 MB knowledge base vector storage ⓘ',
      '10 knowledge requests / minute',
      'Standard document processing ⓘ',
      '1,000 trigger events total ⓘ',
      'Standard workflow execution queue',
      'Community & documentation support',
    ],
    [
      'No monthly app run limit',
      '5,000 AI credits/month (basic and selected advanced models) ⓘ',
      '3 team members',
      'Real-time canvas collaboration ⓘ',
      'Up to 50 apps',
      'App version control',
      'Custom Web App branding ⓘ',
      'App log retention and archiving ⓘ',
      '500 knowledge documents',
      '5 GB knowledge base vector storage ⓘ',
      '100 knowledge requests / minute',
      'Priority document processing ⓘ',
      '20,000 trigger events / month ⓘ',
      'Faster workflow execution queue',
      'LLM API key load balancing ⓘ',
      'Ticket support',
      'SOC 2 Type I report access ⓘ',
    ],
    [
      'No monthly app run limit',
      '10,000 AI credits/month (basic and selected advanced models) ⓘ',
      '50 team members',
      'Real-time canvas collaboration ⓘ',
      'Up to 200 apps',
      'App version control',
      'Custom Web App branding ⓘ',
      'App log retention and archiving ⓘ',
      '5,000 knowledge documents',
      '20 GB knowledge base vector storage ⓘ',
      '1,000 knowledge requests / minute',
      'Top-priority document processing ⓘ',
      'Unlimited trigger events ⓘ',
      'Priority workflow execution queue',
      'LLM API key load balancing ⓘ',
      'Priority ticket support',
      'SOC 2 reports & ISO 27001 certificate access ⓘ',
    ],
  ])
})

it('explains knowledge base vector storage on every plan', async () => {
  await openPricing()
  for (const label of [
    '50 MB knowledge base vector storage',
    '5 GB knowledge base vector storage',
    '20 GB knowledge base vector storage',
  ]) {
    const storage = page.getByRole('button', { name: label, exact: true })
    storage.element().focus()
    await userEvent.keyboard('{Enter}')
    const popup = page.getByRole('dialog', { name: label, exact: true })
    await expect.element(popup).toHaveTextContent(billing['pricing.storage.tooltip'])
    await userEvent.keyboard('{Escape}')
    await expect.element(popup).not.toBeInTheDocument()
    await expect.element(storage).toHaveFocus()
  }
})
