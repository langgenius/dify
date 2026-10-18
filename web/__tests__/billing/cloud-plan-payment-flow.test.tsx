import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ALL_PLANS } from '@/app/components/billing/config'
import { CloudPlanItem } from '@/app/components/billing/pricing/plans/cloud-plan-item'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
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
      <AppToastHost timeout={0} />
      <CloudPlanItem
        plan={plan}
        billingInterval={billingInterval}
        billing={{
          currentPlan,
          currentBillingInterval: 'month',
          isEducationDiscountEligible: false,
          isEducationDiscountActivated: false,
        }}
      />
    </>,
    { wrapper },
  )
}
const popup = { opener: null as unknown, location: { href: '' }, close: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  toast.dismiss()
  canManageBilling = true
  mockGetSubscription.mockReset().mockResolvedValue({ url: 'https://pay.example.com/checkout' })
  mockGetInvoices.mockReset().mockResolvedValue({ url: 'https://pay.example.com/invoices' })
  vi.stubGlobal('location', { href: 'https://app.example.com/billing' })
  popup.opener = window
  popup.location.href = ''
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Cloud plan payment flow', () => {
  it.each([
    { plan: 'professional', interval: 'month', label: 'startBuilding' },
    { plan: 'team', interval: 'year', label: 'getStarted' },
  ] as const)(
    'displays $plan pricing and redirects to its $interval checkout',
    async ({ plan, interval, label }) => {
      const user = userEvent.setup()
      renderPlan({ plan, billingInterval: interval })
      const price = ALL_PLANS[plan].price
      expect(screen.getByText(`$${price * (interval === 'year' ? 10 : 1)}`)).toBeInTheDocument()
      if (interval === 'year') expect(screen.getByText(`$${price * 12}`)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: `billing.plansCommon.${label}` }))
      await waitFor(() => expect(window.location.href).toBe('https://pay.example.com/checkout'))
      expect(mockGetSubscription).toHaveBeenCalledExactlyOnceWith({ query: { plan, interval } })
      expect(mockGetInvoices).not.toHaveBeenCalled()
    },
  )

  it.each([
    { currentPlan: 'sandbox', plan: 'sandbox', label: 'currentPlan' },
    { currentPlan: 'professional', plan: 'sandbox', label: 'startForFree' },
    { currentPlan: 'team', plan: 'sandbox', label: 'startForFree' },
    { currentPlan: 'team', plan: 'professional', label: 'startBuilding' },
  ] as const)(
    'prevents purchasing $plan from $currentPlan',
    async ({ currentPlan, plan, label }) => {
      const user = userEvent.setup()
      renderPlan({ currentPlan, plan })
      const button = screen.getByRole('button', { name: `billing.plansCommon.${label}` })
      expect(button).toBeDisabled()
      await user.click(button)
      expect(mockGetSubscription).not.toHaveBeenCalled()
      expect(mockGetInvoices).not.toHaveBeenCalled()
      expect(window.open).not.toHaveBeenCalled()
    },
  )

  it('opens the billing portal for the current paid subscription after resolving its URL', async () => {
    const user = userEvent.setup()
    const request = createDeferred<{ url: string }>()
    mockGetInvoices.mockReturnValue(request.promise)
    renderPlan({ currentPlan: 'professional', plan: 'professional' })
    await user.click(screen.getByRole('button', { name: 'billing.plansCommon.currentPlan' }))
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank', undefined)
    expect(popup.opener).toBeNull()
    expect(popup.location.href).toBe('')
    await act(async () => request.resolve({ url: 'https://pay.example.com/invoices' }))
    await waitFor(() => expect(popup.location.href).toBe('https://pay.example.com/invoices'))
    expect(mockGetInvoices).toHaveBeenCalledOnce()
    expect(mockGetSubscription).not.toHaveBeenCalled()
  })

  it('closes the pending portal and reports its URL request failure', async () => {
    const user = userEvent.setup()
    mockGetInvoices.mockRejectedValueOnce(new Error('Billing unavailable'))
    renderPlan({ currentPlan: 'professional', plan: 'professional' })
    await user.click(screen.getByRole('button', { name: 'billing.plansCommon.currentPlan' }))
    expect(await screen.findByText('Billing unavailable')).toBeInTheDocument()
    expect(popup.close).toHaveBeenCalledOnce()
    expect(popup.location.href).toBe('')
  })

  it('prevents duplicate subscription requests while checkout is pending', async () => {
    const request = createDeferred<{ url: string }>()
    mockGetSubscription.mockReturnValue(request.promise)
    const user = userEvent.setup()
    renderPlan()
    const button = screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })
    await user.click(button)
    await user.click(button)
    expect(mockGetSubscription).toHaveBeenCalledOnce()
    await act(async () => request.resolve({ url: 'https://pay.example.com/checkout' }))
    expect(window.location.href).toBe('https://pay.example.com/checkout')
  })

  it.each([
    { currentPlan: 'sandbox', label: 'startBuilding' },
    { currentPlan: 'professional', label: 'currentPlan' },
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
