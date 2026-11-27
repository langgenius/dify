import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { focusManager } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import modelProvider from '@/i18n/locales/en-US/model-provider.json'
import {
  createTokenerCreditsFixture,
  createTokenerMeteringFixture,
} from '@/test/console/model-billing'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, setupFakeApi } from '@/test/fake-api'
import QuotaPanel from '../quota-panel'

vi.unmock('react-i18next')

const billingUrl = 'https://console-staging.tokener.dev/partner-billing#code=fixture-code'
const billingLink = { url: billingUrl, expires_at: '2030-01-01T00:00:00Z' }

const creditsFixture = (purchasedMicro = '0') =>
  createTokenerCreditsFixture({
    tokener_billing_link_enabled: true,
    tokener_metering: createTokenerMeteringFixture({
      available_usd_micro: (446036n + BigInt(purchasedMicro)).toString(),
      plan_allowance: {
        plan: 'sandbox',
        amount_usd_micro: '446036',
        available_usd_micro: '446036',
        starts_at: '2026-11-26T00:00:00Z',
        ends_at: null,
      },
      purchased_available_usd_micro: purchasedMicro,
    }),
  })

let credits: ModelProviderCreditsResponse

const fake = setupFakeApi(() => ({
  console: {
    workspaces: {
      current: {
        modelProviders: {
          credits: { get: () => credits },
          tokenerBillingLink: { post: () => billingLink },
        },
      },
    },
  },
}))

beforeEach(() => {
  credits = creditsFixture()
})

async function setup(role: 'owner' | 'admin' | 'normal' = 'owner') {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, modelProvider } },
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    currentWorkspace: { role },
    systemFeatures: { deployment_edition: 'CLOUD' },
    trialModels: [],
  })
  onTestFinished(() => queryClient.clear())
  return render(
    <Providers>
      <I18nextProvider i18n={i18n}>
        <QuotaPanel providers={[]} />
      </I18nextProvider>
    </Providers>,
  )
}

function captureBillingPopup() {
  const popup = { location: { href: 'about:blank' }, opener: window, close: vi.fn() }
  // boundary: capture the new-tab destination without opening an external billing site.
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  onTestFinished(() => open.mockRestore())
  return { open, popup }
}

it('opens the owner’s restricted billing tab and refreshes the server balance on return', async () => {
  const { open, popup } = captureBillingPopup()
  const screen = await setup()
  await expect.element(screen.getByText('USD 0.00')).toBeVisible()
  const createLink = fake.console.workspaces.current.modelProviders.tokenerBillingLink.post
  expect(createLink).not.toHaveBeenCalled()

  await screen.getByRole('button', { name: 'Buy Credits' }).click()
  await expect.poll(() => popup.location.href).toBe(billingUrl)
  expect(open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank', undefined)
  expect(popup.opener).toBeNull()
  expect(createLink).toHaveBeenCalledTimes(1)
  await expect.element(screen.getByText('USD 0.00')).toBeVisible()

  // Drive TanStack Query's public focus boundary; the browser test does not open a real tab.
  onTestFinished(() => focusManager.setFocused(undefined))
  focusManager.setFocused(false)
  credits = creditsFixture('1000000')
  focusManager.setFocused(true)
  await expect.element(screen.getByText('USD 1.00')).toBeVisible()
  await expect.element(screen.getByText('200 / 200 Credits')).toBeVisible()
  expect(createLink).toHaveBeenCalledTimes(1)
})

it('lets an admin open purchase history in the same restricted billing surface', async () => {
  const { popup } = captureBillingPopup()
  const screen = await setup('admin')
  await expect.element(screen.getByRole('button', { name: 'Buy Credits' })).toBeVisible()
  await screen.getByRole('button', { name: 'Purchase history' }).click()
  await expect.poll(() => popup.location.href).toBe(billingUrl)
  expect(
    fake.console.workspaces.current.modelProviders.tokenerBillingLink.post,
  ).toHaveBeenCalledTimes(1)
})

it.each([
  { role: 'normal', availability: true, why: 'member' },
  { role: 'owner', availability: undefined, why: 'owner without the server flag' },
] as const)('keeps billing actions hidden for a $why', async ({ role, availability }) => {
  credits = { ...credits, tokener_billing_link_enabled: availability }
  const screen = await setup(role)
  await expect.element(screen.getByText('USD 0.00')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Buy Credits' })).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Purchase history' }))
    .not.toBeInTheDocument()
  expect(
    fake.console.workspaces.current.modelProviders.tokenerBillingLink.post,
  ).not.toHaveBeenCalled()
})

it('does not create a billing grant if the browser blocks opening the tab', async () => {
  // boundary: the browser rejected the new tab; no external window may be opened.
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  onTestFinished(() => open.mockRestore())
  const screen = await setup()
  await screen.getByRole('button', { name: 'Buy Credits' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Could not open Tokener billing. Try again.')
  expect(
    fake.console.workspaces.current.modelProviders.tokenerBillingLink.post,
  ).not.toHaveBeenCalled()
})

it('shows a failed link without retrying or increasing the displayed balance', async () => {
  const { popup } = captureBillingPopup()
  const createLink = fake.console.workspaces.current.modelProviders.tokenerBillingLink.post
  createLink.mockRejectedValueOnce(apiError({ status: 503, message: 'Billing unavailable' }))
  const screen = await setup()
  await screen.getByRole('button', { name: 'Buy Credits' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Could not open Tokener billing. Try again.')
  await expect.element(screen.getByText('USD 0.00')).toBeVisible()
  expect(popup.close).toHaveBeenCalledTimes(1)
  expect(createLink).toHaveBeenCalledTimes(1)
})
