import type { EducationStatusResponse } from '@dify/contracts/api/console/account/types.gen'
import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedEducationStatus,
  seedFeatures,
} from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createDeferred } from '@/test/deferred'
import { PricingContent } from '../content'

let billingPopup: {
  location: { href: string }
  opener: Window | null
  close: ReturnType<typeof vi.fn>
}
beforeEach(() => {
  billingPopup = { location: { href: '' }, opener: window, close: vi.fn() }
  vi.spyOn(window, 'open').mockImplementation(() => billingPopup as unknown as Window)
})

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ isCurrentWorkspaceManager: true }))
})

function setup() {
  const queryClient = createConsoleQueryClient()
  const { wrapper } = createConsoleQueryWrapper({ queryClient })
  return {
    queryClient,
    show: () =>
      render(
        <Dialog>
          <PricingContent />
        </Dialog>,
        { wrapper },
      ),
  }
}

it('shows prices and disables purchase buttons while features load', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  let resolveFeatures!: (data: GetFeaturesResponse) => void
  const request = queryClient.query({
    ...consoleQuery.features.get.queryOptions(),
    queryFn: () =>
      new Promise<GetFeaturesResponse>((resolve) => {
        resolveFeatures = resolve
      }),
  })
  show()
  expect(screen.getByRole('status')).toHaveTextContent('appApi.loading')
  expect(screen.getByRole('heading', { name: 'Dify Cloud' })).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'billing.plansCommon.comparePlanAndFeatures' }),
  ).toBeVisible()
  expect(screen.getByRole('heading', { name: 'billing.plans.professional.name' })).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' }),
  ).toBeDisabled()
  expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.getByText('$59')).toBeVisible()
  expect(screen.getByText('$159')).toBeVisible()
  await user.click(screen.getByRole('radio', { name: /billing\.pricing\.annually/ }))
  expect(screen.getByText('$590')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' }),
  ).toBeDisabled()
  await act(async () => {
    resolveFeatures(
      seedFeatures(createConsoleQueryClient(), { billing: { subscription: { plan: 'team' } } }),
    )
    await request
  })
  expect(await screen.findByText('billing.plans.team.name')).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('shows only the payable prices for the selected interval', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  seedFeatures(queryClient)
  show()

  await user.click(screen.getByRole('radio', { name: /billing\.pricing\.annually/ }))
  expect(screen.getByText('$590')).toBeVisible()
  expect(screen.getByText('$1590')).toBeVisible()
  expect(screen.queryByText('$708')).not.toBeInTheDocument()
  expect(screen.queryByText('$1908')).not.toBeInTheDocument()

  await user.click(screen.getByRole('radio', { name: /billing\.pricing\.monthly/ }))
  expect(screen.getByText('$59')).toBeVisible()
  expect(screen.getByText('$159')).toBeVisible()
  expect(screen.queryByText('$590')).not.toBeInTheDocument()
  expect(screen.queryByText('$1590')).not.toBeInTheDocument()
})

it('preserves a billing interval selected before education eligibility arrives', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  seedFeatures(queryClient, { education: { enabled: true } })
  let resolveEducation!: (data: EducationStatusResponse) => void
  const options = consoleQuery.account.education.get.queryOptions()
  const request = queryClient.query({
    ...options,
    queryFn: () =>
      new Promise((resolve) => {
        resolveEducation = resolve
      }),
  })
  show()
  expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.getByRole('heading', { name: 'billing.plans.professional.name' })).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' }),
  ).toBeDisabled()
  await user.click(screen.getByRole('radio', { name: /billing\.pricing\.annually/ }))
  await user.click(screen.getByRole('radio', { name: 'billing.pricing.monthly' }))
  await act(async () => {
    resolveEducation({
      is_student: true,
      allow_refresh: false,
      can_redeem_discount: true,
      expire_at: null,
      result: true,
    })
    await request
  })
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).not.toBeChecked()
  expect(screen.getByText('$59')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' }),
  ).toBeEnabled()
  act(() =>
    queryClient.setQueryData(options.queryKey, {
      is_student: true,
      allow_refresh: true,
      can_redeem_discount: true,
      expire_at: null,
      result: true,
    }),
  )
  expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).not.toBeChecked()
})

it('shows yearly pricing immediately for a cached eligible education account', () => {
  const { queryClient, show } = setup()
  seedFeatures(queryClient, { education: { enabled: true } })
  queryClient.setQueryData(consoleQuery.account.education.get.queryOptions().queryKey, {
    is_student: true,
    allow_refresh: false,
    can_redeem_discount: true,
    result: true,
    expire_at: null,
  })
  show()
  expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).toBeChecked()
  expect(screen.getByText('$590')).toBeVisible()
  expect(screen.getByRole('button', { name: 'education.useEducationDiscount' })).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it.each([
  ['year', true],
  ['month', false],
] as const)(
  'opens the Team change flow for a paid plan with %s billing and education activated=%s',
  async (interval, activated) => {
    const user = userEvent.setup()
    const { queryClient, show } = setup()
    seedFeatures(queryClient, {
      billing: { subscription: { plan: 'professional', interval: 'year' } },
      education: { enabled: true, activated },
    })
    seedEducationStatus(queryClient, { is_student: true })
    const checkoutUrl = 'https://billing.example.com/team-checkout'
    const checkout = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: checkoutUrl }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const navigate = vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
    show()
    if (interval === 'month')
      await user.click(screen.getByRole('radio', { name: 'billing.pricing.monthly' }))

    await user.click(screen.getByRole('button', { name: 'billing.plansCommon.upgradeToTeam' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(checkoutUrl))
    expect(checkout).toHaveBeenCalledTimes(1)
    const requestUrl = new URL((checkout.mock.calls[0]?.[0] as Request).url)
    expect(requestUrl.pathname).toBe('/console/api/billing/subscription')
    expect(requestUrl.searchParams.get('plan')).toBe('team')
    expect(requestUrl.searchParams.get('interval')).toBe(interval)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  },
)

it('offers education pricing before Team checkout when the discount has not been activated', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  seedFeatures(queryClient, { education: { enabled: true, activated: false } })
  seedEducationStatus(queryClient, { is_student: true })
  const pending = createDeferred<Response>()
  const checkout = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending.promise)
  show()

  await user.click(screen.getByRole('button', { name: 'billing.plansCommon.upgradeToTeam' }))

  expect(
    await screen.findByRole('dialog', { name: 'education.educationPricingConfirm.title' }),
  ).toBeVisible()
  expect(checkout).not.toHaveBeenCalled()
  const navigate = vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
  await user.click(screen.getByRole('button', { name: 'education.educationPricingConfirm.cancel' }))
  const switchPlan = screen.getByRole('button', {
    name: 'education.educationPricingConfirm.continue',
  })
  expect(switchPlan).toBeDisabled()
  await user.click(switchPlan)
  expect(checkout).toHaveBeenCalledTimes(1)
  await act(async () =>
    pending.resolve(
      new Response(JSON.stringify({ url: 'https://billing.example.com/team-checkout' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith('https://billing.example.com/team-checkout'),
  )
  const target = new URL((checkout.mock.calls[0]?.[0] as Request).url)
  expect(target.searchParams.get('plan')).toBe('team')
  expect(target.searchParams.get('interval')).toBe('year')
})

it('keeps plan information visible after a request failure and restores billing on retry', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  queryClient.setDefaultOptions({
    queries: { retry: false, retryOnMount: false, staleTime: Infinity },
  })
  const features = seedFeatures(createConsoleQueryClient())
  vi.spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue(
      new Response(JSON.stringify(features), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('common.error')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'billing.plans.sandbox.name' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'billing.plansCommon.startForFree' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText('$59')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' }),
  ).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(
    await screen.findByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' }),
  ).toBeEnabled()
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('lets paid subscribers manage or upgrade without requesting education eligibility', async () => {
  const { queryClient, show } = setup()
  seedFeatures(queryClient, {
    billing: { subscription: { plan: 'professional', interval: 'year' } },
    education: { enabled: true, activated: false },
  })
  const fetch = vi.spyOn(globalThis, 'fetch')
  show()
  expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).toBeChecked()
  expect(screen.getByText('billing.plansCommon.currentPlan')).toBeVisible()
  expect(screen.queryByText('billing.plansCommon.mostPopular')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'billing.plansCommon.manageSubscription' }),
  ).toBeEnabled()
  expect(screen.getByRole('button', { name: 'billing.plansCommon.upgradeToTeam' })).toBeEnabled()
  expect(fetch).not.toHaveBeenCalled()
})

it('selects the billing interval using the named options', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  seedFeatures(queryClient)
  show()
  expect(screen.getByRole('radiogroup', { name: 'billing.pricing.billingInterval' })).toBeVisible()
  await user.click(screen.getByRole('radio', { name: /billing\.pricing\.annually/ }))
  expect(screen.getByText('$590')).toBeVisible()
  await user.click(screen.getByRole('radio', { name: 'billing.pricing.monthly' }))
  expect(screen.getByText('$59')).toBeVisible()
})

it.each([
  ['professional', 'month', 'year'],
  ['professional', 'year', 'month'],
  ['team', 'month', 'year'],
  ['team', 'year', 'month'],
] as const)(
  'confirms the %s cycle change from %s to %s before opening the portal',
  async (plan, currentInterval, selectedInterval) => {
    const user = userEvent.setup()
    const { queryClient, show } = setup()
    seedFeatures(queryClient, {
      billing: { subscription: { plan, interval: currentInterval } },
    })
    const fetchPortal = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://billing.example.com/portal' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    show()
    await user.click(
      screen.getByRole('radio', {
        name:
          selectedInterval === 'year' ? /billing\.pricing\.annually/ : 'billing.pricing.monthly',
      }),
    )
    expect(screen.queryByText('billing.plansCommon.currentPlan')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'billing.plansCommon.manageSubscription',
      }),
    )
    expect(fetchPortal).not.toHaveBeenCalled()
    const back = screen.getByRole('button', { name: 'billing.pricing.cycleNotice.back' })
    await user.click(back)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'billing.plansCommon.manageSubscription' }))
    const dialog = screen.getByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'billing.plansCommon.manageSubscription' }),
    )
    await waitFor(() =>
      expect(billingPopup.location.href).toBe('https://billing.example.com/portal'),
    )
    expect(fetchPortal).toHaveBeenCalledTimes(1)
    const request = fetchPortal.mock.calls[0]?.[0] as Request
    expect(new URL(request.url).pathname).toBe('/console/api/billing/invoices')
  },
)

it.each(['month', 'year'] as const)(
  'opens the portal for the current %s subscription',
  async (interval) => {
    const user = userEvent.setup()
    const { queryClient, show } = setup()
    seedFeatures(queryClient, {
      billing: { subscription: { plan: 'professional', interval } },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://billing.example.com' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    show()
    if (interval === 'year')
      await user.click(screen.getByRole('radio', { name: /billing\.pricing\.annually/ }))
    await user.click(screen.getByRole('button', { name: 'billing.plansCommon.manageSubscription' }))
    await waitFor(() => expect(billingPopup.location.href).toBe('https://billing.example.com'))
  },
)
