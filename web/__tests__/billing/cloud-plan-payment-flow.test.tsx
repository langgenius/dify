import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { ORPCError } from '@orpc/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ALL_PLANS } from '@/app/components/billing/config'
import { CloudPlanCard } from '@/app/components/billing/pricing/plan-card'
import { PlanFeatureInfotip } from '@/app/components/billing/pricing/plan-card/features'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createDeferred } from '@/test/deferred'

const { mockGetSubscription, mockGetInvoices } = vi.hoisted(() => ({
  mockGetSubscription: vi.fn(),
  mockGetInvoices: vi.fn(),
}))
let canManageBilling = true
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ isCurrentWorkspaceManager: canManageBilling }))
})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'billing.subscription.get': mockGetSubscription,
      'billing.invoices.get': mockGetInvoices,
    }),
  }
})
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}))

const renderPlan = ({
  currentPlan = 'sandbox',
  plan = 'professional',
  billingInterval = 'month',
}: {
  currentPlan?: CloudPlan
  plan?: CloudPlan
  billingInterval?: GetBillingSubscriptionData['query']['interval']
} = {}) => {
  const { wrapper } = createConsoleQueryWrapper()
  return render(
    <>
      <AppToaster timeout={0} />
      <PlanFeatureInfotip>
        <CloudPlanCard
          plan={plan}
          billingInterval={billingInterval}
          billing={{
            currentPlan,
            currentBillingInterval: 'month',
            isEducationDiscountEligible: false,
          }}
        />
      </PlanFeatureInfotip>
    </>,
    { wrapper },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  toast.dismiss()
  canManageBilling = true
  mockGetSubscription.mockReset().mockResolvedValue({ url: 'https://pay.example.com/checkout' })
  mockGetInvoices.mockReset().mockResolvedValue({ url: 'https://pay.example.com/invoices' })
  vi.stubGlobal('location', { href: 'https://app.example.com/billing' })
  vi.spyOn(window, 'open').mockReturnValue(null)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Cloud plan payment flow', () => {
  it.each([
    { plan: 'professional', interval: 'month', label: 'upgradeToProfessional' },
    { plan: 'team', interval: 'year', label: 'upgradeToTeam' },
  ] as const)(
    'displays $plan pricing and redirects to its $interval checkout',
    async ({ plan, interval, label }) => {
      const user = userEvent.setup()
      renderPlan({ plan, billingInterval: interval })
      const price = ALL_PLANS[plan].price
      expect(screen.getByText(`$${price * (interval === 'year' ? 10 : 1)}`)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: `billing.plansCommon.${label}` }))
      await waitFor(() => expect(window.location.href).toBe('https://pay.example.com/checkout'))
      expect(mockGetSubscription).toHaveBeenCalledExactlyOnceWith(
        { query: { plan, interval } },
        { context: { silent: true } },
      )
      expect(mockGetInvoices).not.toHaveBeenCalled()
    },
  )

  it('explains a failed checkout and keeps the user on the plan', async () => {
    const user = userEvent.setup()
    const startUrl = window.location.href
    mockGetSubscription.mockRejectedValueOnce(
      new ORPCError('billing_request_in_progress', {
        defined: true,
        status: 429,
        message: 'Backend text',
      }),
    )
    renderPlan()
    const button = screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' })
    await user.click(button)
    expect(await screen.findByText('billing.errors.requestInProgress')).toBeInTheDocument()
    expect(screen.queryByText('Backend text')).not.toBeInTheDocument()
    expect(window.location.href).toBe(startUrl)
    expect(button).toBeEnabled()
  })

  it.each([
    ['sandbox', 'sandbox'],
    ['professional', 'sandbox'],
    ['team', 'sandbox'],
    ['team', 'professional'],
  ] as const)('hides the purchase action for %s viewing %s', (currentPlan, plan) => {
    renderPlan({ currentPlan, plan })
    expect(
      screen.queryByRole('button', {
        name: /billing\.plansCommon\.(startForFree|startBuilding|getStarted|upgradeToProfessional|upgradeToTeam|manageSubscription)$/,
      }),
    ).not.toBeInTheDocument()
  })

  it('opens the billing portal for the current paid subscription after resolving its URL', async () => {
    const user = userEvent.setup()
    const request = createDeferred<{ url: string }>()
    mockGetInvoices.mockReturnValue(request.promise)
    renderPlan({ currentPlan: 'professional', plan: 'professional' })
    await user.click(screen.getByRole('button', { name: 'billing.plansCommon.manageSubscription' }))
    expect(window.location.href).toBe('https://app.example.com/billing')
    await act(async () => request.resolve({ url: 'https://pay.example.com/invoices' }))
    await waitFor(() => expect(window.location.href).toBe('https://pay.example.com/invoices'))
    expect(window.open).not.toHaveBeenCalled()
    expect(mockGetInvoices).toHaveBeenCalledOnce()
    expect(mockGetSubscription).not.toHaveBeenCalled()
  })

  it('stays on the billing page and reports a portal URL request failure', async () => {
    const user = userEvent.setup()
    mockGetInvoices.mockRejectedValueOnce(
      new ORPCError('billing_unavailable', { defined: true, status: 503, message: 'Backend text' }),
    )
    renderPlan({ currentPlan: 'professional', plan: 'professional' })
    await user.click(screen.getByRole('button', { name: 'billing.plansCommon.manageSubscription' }))
    expect(await screen.findByText('billing.errors.unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Backend text')).not.toBeInTheDocument()
    expect(window.location.href).toBe('https://app.example.com/billing')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('prevents duplicate subscription requests while checkout is pending', async () => {
    const request = createDeferred<{ url: string }>()
    mockGetSubscription.mockReturnValue(request.promise)
    const user = userEvent.setup()
    renderPlan()
    const button = screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' })
    await user.click(button)
    await user.click(button)
    expect(mockGetSubscription).toHaveBeenCalledOnce()
    await act(async () => request.resolve({ url: 'https://pay.example.com/checkout' }))
    expect(window.location.href).toBe('https://pay.example.com/checkout')
  })

  it.each([
    { currentPlan: 'sandbox', label: 'startBuilding' },
    { currentPlan: 'professional', label: 'startBuilding' },
  ] as const)(
    'blocks the $label action without billing permission',
    async ({ currentPlan, label }) => {
      const user = userEvent.setup()
      canManageBilling = false
      renderPlan({ currentPlan })
      await user.click(screen.getByRole('button', { name: `billing.plansCommon.${label}` }))
      expect(await screen.findByText('billing.buyPermissionDeniedTip')).toBeInTheDocument()
      expect(mockGetSubscription).not.toHaveBeenCalled()
      expect(mockGetInvoices).not.toHaveBeenCalled()
      expect(window.open).not.toHaveBeenCalled()
    },
  )
})
