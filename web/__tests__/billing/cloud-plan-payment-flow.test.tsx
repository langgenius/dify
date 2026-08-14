/**
 * Integration test: Cloud Plan Payment Flow
 *
 * Tests the payment flow for cloud plan items:
 *   CloudPlanItem → Button click → payment capability check → fetch URL → redirect
 *
 * Covers plan comparison, downgrade prevention, monthly/yearly pricing,
 * and workspace manager permission enforcement.
 */
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { toast, ToastHost } from '@langgenius/dify-ui/toast'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { ALL_PLANS } from '@/app/components/billing/config'
import { PlanRange } from '@/app/components/billing/pricing/plan-switcher/plan-range-switcher'
import CloudPlanItem from '@/app/components/billing/pricing/plans/cloud-plan-item'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'

// ─── Mock state ──────────────────────────────────────────────────────────────
let mockConsoleState: Record<string, unknown> = {}
const mockGetSubscription = vi.fn()
const mockOpenAsyncWindow = vi.fn()

// ─── Context mocks ───────────────────────────────────────────────────────────

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  return {
    ...actual,
    consoleClient: new Proxy(actual.consoleClient, {
      get(target, prop, receiver) {
        if (prop === 'billing') {
          return {
            invoices: target.billing.invoices,
            subscription: { get: mockGetSubscription },
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    }),
  }
})

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => mockOpenAsyncWindow,
}))

// ─── Navigation mocks ───────────────────────────────────────────────────────
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────
const setupConsoleState = (overrides: Record<string, unknown> = {}) => {
  mockConsoleState = {
    isCurrentWorkspaceManager: true,
    ...overrides,
  }
}

type RenderCloudPlanItemOptions = {
  currentPlan?: CloudPlan
  plan?: CloudPlan
  planRange?: PlanRange
  canPay?: boolean
}

const renderCloudPlanItem = ({
  currentPlan = 'sandbox',
  plan = 'professional',
  planRange = PlanRange.monthly,
  canPay = true,
}: RenderCloudPlanItemOptions = {}) => {
  const { wrapper } = createConsoleQueryWrapper()
  return render(
    <>
      <ToastHost timeout={0} />
      <CloudPlanItem currentPlan={currentPlan} plan={plan} planRange={planRange} canPay={canPay} />
    </>,
    { wrapper },
  )
}

const getPlanButton = (name: string) => screen.getByRole('button', { name })

// ═══════════════════════════════════════════════════════════════════════════════
describe('Cloud Plan Payment Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    toast.dismiss()
    setupConsoleState()
    mockGetSubscription.mockResolvedValue({ url: 'https://pay.example.com/checkout' })
  })

  // ─── 1. Plan Display ────────────────────────────────────────────────────
  describe('Plan display', () => {
    it('should render plan name and description', () => {
      renderCloudPlanItem({ plan: 'professional' })

      expect(screen.getByText(/plans\.professional\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.professional\.description/i)).toBeInTheDocument()
    })

    it('should show "Free" price for sandbox plan', () => {
      renderCloudPlanItem({ plan: 'sandbox' })

      expect(screen.getByText(/plansCommon\.free/i)).toBeInTheDocument()
    })

    it('should show monthly price for paid plans', () => {
      renderCloudPlanItem({ plan: 'professional', planRange: PlanRange.monthly })

      expect(screen.getByText(`$${ALL_PLANS.professional.price}`)).toBeInTheDocument()
    })

    it('should show yearly discounted price (10 months) and strikethrough original (12 months)', () => {
      renderCloudPlanItem({ plan: 'professional', planRange: PlanRange.yearly })

      const yearlyPrice = ALL_PLANS.professional.price * 10
      const originalPrice = ALL_PLANS.professional.price * 12

      expect(screen.getByText(`$${yearlyPrice}`)).toBeInTheDocument()
      expect(screen.getByText(`$${originalPrice}`)).toBeInTheDocument()
    })

    it('should show "most popular" badge for professional plan', () => {
      renderCloudPlanItem({ plan: 'professional' })

      expect(screen.getByText(/plansCommon\.mostPopular/i)).toBeInTheDocument()
    })

    it('should not show "most popular" badge for sandbox or team plans', () => {
      const { unmount } = renderCloudPlanItem({ plan: 'sandbox' })
      expect(screen.queryByText(/plansCommon\.mostPopular/i)).not.toBeInTheDocument()
      unmount()

      renderCloudPlanItem({ plan: 'team' })
      expect(screen.queryByText(/plansCommon\.mostPopular/i)).not.toBeInTheDocument()
    })
  })

  // ─── 2. Button Text Logic ───────────────────────────────────────────────
  describe('Button text logic', () => {
    it('should show "Current Plan" when plan matches current plan', () => {
      renderCloudPlanItem({ currentPlan: 'professional', plan: 'professional' })

      expect(screen.getByText(/plansCommon\.currentPlan/i)).toBeInTheDocument()
    })

    it('should show "Start for Free" for sandbox plan when not current', () => {
      renderCloudPlanItem({ currentPlan: 'professional', plan: 'sandbox' })

      expect(screen.getByText(/plansCommon\.startForFree/i)).toBeInTheDocument()
    })

    it('should show "Start Building" for professional plan when not current', () => {
      renderCloudPlanItem({ currentPlan: 'sandbox', plan: 'professional' })

      expect(screen.getByText(/plansCommon\.startBuilding/i)).toBeInTheDocument()
    })

    it('should show "Get Started" for team plan when not current', () => {
      renderCloudPlanItem({ currentPlan: 'sandbox', plan: 'team' })

      expect(screen.getByText(/plansCommon\.getStarted/i)).toBeInTheDocument()
    })
  })

  // ─── 3. Downgrade Prevention ────────────────────────────────────────────
  describe('Downgrade prevention', () => {
    it('should disable sandbox button when user is on professional plan (downgrade)', () => {
      renderCloudPlanItem({ currentPlan: 'professional', plan: 'sandbox' })

      const button = getPlanButton('billing.plansCommon.startForFree')
      expect(button).toBeDisabled()
    })

    it('should disable sandbox and professional buttons when user is on team plan', () => {
      const { unmount } = renderCloudPlanItem({ currentPlan: 'team', plan: 'sandbox' })
      expect(getPlanButton('billing.plansCommon.startForFree')).toBeDisabled()
      unmount()

      renderCloudPlanItem({ currentPlan: 'team', plan: 'professional' })
      expect(getPlanButton('billing.plansCommon.startBuilding')).toBeDisabled()
    })

    it('should not disable current paid plan button (for invoice management)', () => {
      renderCloudPlanItem({ currentPlan: 'professional', plan: 'professional' })

      const button = getPlanButton('billing.plansCommon.currentPlan')
      expect(button).not.toBeDisabled()
    })

    it('should enable higher-tier plan buttons for upgrade', () => {
      renderCloudPlanItem({ currentPlan: 'sandbox', plan: 'team' })

      const button = getPlanButton('billing.plansCommon.getStarted')
      expect(button).not.toBeDisabled()
    })
  })

  // ─── 4. Payment URL Flow ────────────────────────────────────────────────
  describe('Payment URL flow', () => {
    it('should call get subscription with plan and "month" for monthly range', async () => {
      const user = userEvent.setup()
      // Simulate clicking on a professional plan button (user is on sandbox)
      renderCloudPlanItem({
        currentPlan: 'sandbox',
        plan: 'professional',
        planRange: PlanRange.monthly,
      })

      const button = getPlanButton('billing.plansCommon.startBuilding')
      await user.click(button)

      await waitFor(() => {
        expect(mockGetSubscription).toHaveBeenCalledWith({
          query: { plan: 'professional', interval: 'month' },
        })
      })
    })

    it('should call get subscription with plan and "year" for yearly range', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({
        currentPlan: 'sandbox',
        plan: 'team',
        planRange: PlanRange.yearly,
      })

      const button = getPlanButton('billing.plansCommon.getStarted')
      await user.click(button)

      await waitFor(() => {
        expect(mockGetSubscription).toHaveBeenCalledWith({
          query: { plan: 'team', interval: 'year' },
        })
      })
    })

    it('should open invoice management for current paid plan', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({ currentPlan: 'professional', plan: 'professional' })

      const button = getPlanButton('billing.plansCommon.currentPlan')
      await user.click(button)

      await waitFor(() => {
        expect(mockOpenAsyncWindow).toHaveBeenCalled()
      })
      // Should NOT call get subscription (invoice, not subscription)
      expect(mockGetSubscription).not.toHaveBeenCalled()
    })

    it('should not do anything when clicking on sandbox free plan button', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({ currentPlan: 'sandbox', plan: 'sandbox' })

      const button = getPlanButton('billing.plansCommon.currentPlan')
      await user.click(button)

      // Wait a tick and verify no actions were taken
      await waitFor(() => {
        expect(mockGetSubscription).not.toHaveBeenCalled()
        expect(mockOpenAsyncWindow).not.toHaveBeenCalled()
      })
    })
  })

  // ─── 5. Payment capability ──────────────────────────────────────────────
  describe('Payment capability', () => {
    it('should change plans when payment is allowed', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({ currentPlan: 'sandbox', plan: 'professional', canPay: true })

      const button = getPlanButton('billing.plansCommon.startBuilding')
      await user.click(button)

      await waitFor(() => {
        expect(mockGetSubscription).toHaveBeenCalledWith({
          query: { plan: 'professional', interval: 'month' },
        })
      })
    })

    it('should block plan changes when payment is not allowed', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({ currentPlan: 'sandbox', plan: 'professional', canPay: false })

      const button = getPlanButton('billing.plansCommon.startBuilding')
      await user.click(button)

      await waitFor(() => {
        expect(screen.getByText('billing.buyPermissionDeniedTip')).toBeInTheDocument()
      })
      expect(mockGetSubscription).not.toHaveBeenCalled()
    })

    it('should open billing portal when payment is allowed', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({
        currentPlan: 'professional',
        plan: 'professional',
        canPay: true,
      })

      const button = getPlanButton('billing.plansCommon.currentPlan')
      await user.click(button)

      await waitFor(() => {
        expect(mockOpenAsyncWindow).toHaveBeenCalled()
      })
      expect(mockGetSubscription).not.toHaveBeenCalled()
    })

    it('should block billing portal access when payment is not allowed', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({
        currentPlan: 'professional',
        plan: 'professional',
        canPay: false,
      })

      const button = getPlanButton('billing.plansCommon.currentPlan')
      await user.click(button)

      await waitFor(() => {
        expect(screen.getByText('billing.buyPermissionDeniedTip')).toBeInTheDocument()
      })
      expect(mockOpenAsyncWindow).not.toHaveBeenCalled()
    })
  })
})
