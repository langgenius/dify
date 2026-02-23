/**
 * Integration test: Cloud Plan Payment Flow
 *
 * Tests the payment flow for cloud plan items:
 *   CloudPlanItem → Button click → permission check → fetch URL → redirect
 *
 * Covers plan comparison, downgrade prevention, monthly/yearly pricing,
 * and workspace manager permission enforcement.
 */
import type { BasicPlan } from '@/app/components/billing/type'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { ALL_PLANS } from '@/app/components/billing/config'
import { PlanRange } from '@/app/components/billing/pricing/plan-switcher/plan-range-switcher'
import CloudPlanItem from '@/app/components/billing/pricing/plans/cloud-plan-item'
import { Plan } from '@/app/components/billing/type'

// ─── Mock state ──────────────────────────────────────────────────────────────
let mockAppCtx: Record<string, unknown> = {}
const mockFetchSubscriptionUrls = vi.fn()
const mockInvoices = vi.fn()
const mockOpenAsyncWindow = vi.fn()
const mockToastNotify = vi.fn()

// ─── Context mocks ───────────────────────────────────────────────────────────
vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockAppCtx,
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

// ─── Service mocks ───────────────────────────────────────────────────────────
vi.mock('@/service/billing', () => ({
  fetchSubscriptionUrls: (...args: unknown[]) => mockFetchSubscriptionUrls(...args),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    billing: {
      invoices: () => mockInvoices(),
    },
  },
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => mockOpenAsyncWindow,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: (args: unknown) => mockToastNotify(args) },
}))

// ─── Navigation mocks ───────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────
const setupAppContext = (overrides: Record<string, unknown> = {}) => {
  mockAppCtx = {
    isCurrentWorkspaceManager: true,
    ...overrides,
  }
}

type RenderCloudPlanItemOptions = {
  currentPlan?: BasicPlan
  plan?: BasicPlan
  planRange?: PlanRange
  canPay?: boolean
}

const renderCloudPlanItem = ({
  currentPlan = Plan.sandbox,
  plan = Plan.professional,
  planRange = PlanRange.monthly,
  canPay = true,
}: RenderCloudPlanItemOptions = {}) => {
  return render(
    <CloudPlanItem
      currentPlan={currentPlan}
      plan={plan}
      planRange={planRange}
      canPay={canPay}
    />,
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('Cloud Plan Payment Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    setupAppContext()
    mockFetchSubscriptionUrls.mockResolvedValue({ url: 'https://pay.example.com/checkout' })
    mockInvoices.mockResolvedValue({ url: 'https://billing.example.com/invoices' })
  })

  // ─── 1. Plan Display ────────────────────────────────────────────────────
  describe('Plan display', () => {
    it('should render plan name and description', () => {
      renderCloudPlanItem({ plan: Plan.professional })

      expect(screen.getByText(/plans\.professional\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.professional\.description/i)).toBeInTheDocument()
    })

    it('should show "Free" price for sandbox plan', () => {
      renderCloudPlanItem({ plan: Plan.sandbox })

      expect(screen.getByText(/plansCommon\.free/i)).toBeInTheDocument()
    })

    it('should show monthly price for paid plans', () => {
      renderCloudPlanItem({ plan: Plan.professional, planRange: PlanRange.monthly })

      expect(screen.getByText(`$${ALL_PLANS.professional.price}`)).toBeInTheDocument()
    })

    it('should show yearly discounted price (10 months) and strikethrough original (12 months)', () => {
      renderCloudPlanItem({ plan: Plan.professional, planRange: PlanRange.yearly })

      const yearlyPrice = ALL_PLANS.professional.price * 10
      const originalPrice = ALL_PLANS.professional.price * 12

      expect(screen.getByText(`$${yearlyPrice}`)).toBeInTheDocument()
      expect(screen.getByText(`$${originalPrice}`)).toBeInTheDocument()
    })

    it('should show "most popular" badge for professional plan', () => {
      renderCloudPlanItem({ plan: Plan.professional })

      expect(screen.getByText(/plansCommon\.mostPopular/i)).toBeInTheDocument()
    })

    it('should not show "most popular" badge for sandbox or team plans', () => {
      const { unmount } = renderCloudPlanItem({ plan: Plan.sandbox })
      expect(screen.queryByText(/plansCommon\.mostPopular/i)).not.toBeInTheDocument()
      unmount()

      renderCloudPlanItem({ plan: Plan.team })
      expect(screen.queryByText(/plansCommon\.mostPopular/i)).not.toBeInTheDocument()
    })
  })

  // ─── 2. Button Text Logic ───────────────────────────────────────────────
  describe('Button text logic', () => {
    it('should show "Current Plan" when plan matches current plan', () => {
      renderCloudPlanItem({ currentPlan: Plan.professional, plan: Plan.professional })

      expect(screen.getByText(/plansCommon\.currentPlan/i)).toBeInTheDocument()
    })

    it('should show "Start for Free" for sandbox plan when not current', () => {
      renderCloudPlanItem({ currentPlan: Plan.professional, plan: Plan.sandbox })

      expect(screen.getByText(/plansCommon\.startForFree/i)).toBeInTheDocument()
    })

    it('should show "Start Building" for professional plan when not current', () => {
      renderCloudPlanItem({ currentPlan: Plan.sandbox, plan: Plan.professional })

      expect(screen.getByText(/plansCommon\.startBuilding/i)).toBeInTheDocument()
    })

    it('should show "Get Started" for team plan when not current', () => {
      renderCloudPlanItem({ currentPlan: Plan.sandbox, plan: Plan.team })

      expect(screen.getByText(/plansCommon\.getStarted/i)).toBeInTheDocument()
    })
  })

  // ─── 3. Downgrade Prevention ────────────────────────────────────────────
  describe('Downgrade prevention', () => {
    it('should disable sandbox button when user is on professional plan (downgrade)', () => {
      renderCloudPlanItem({ currentPlan: Plan.professional, plan: Plan.sandbox })

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('should disable sandbox and professional buttons when user is on team plan', () => {
      const { unmount } = renderCloudPlanItem({ currentPlan: Plan.team, plan: Plan.sandbox })
      expect(screen.getByRole('button')).toBeDisabled()
      unmount()

      renderCloudPlanItem({ currentPlan: Plan.team, plan: Plan.professional })
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should not disable current paid plan button (for invoice management)', () => {
      renderCloudPlanItem({ currentPlan: Plan.professional, plan: Plan.professional })

      const button = screen.getByRole('button')
      expect(button).not.toBeDisabled()
    })

    it('should enable higher-tier plan buttons for upgrade', () => {
      renderCloudPlanItem({ currentPlan: Plan.sandbox, plan: Plan.team })

      const button = screen.getByRole('button')
      expect(button).not.toBeDisabled()
    })
  })

  // ─── 4. Payment URL Flow ────────────────────────────────────────────────
  describe('Payment URL flow', () => {
    it('should call fetchSubscriptionUrls with plan and "month" for monthly range', async () => {
      const user = userEvent.setup()
      // Simulate clicking on a professional plan button (user is on sandbox)
      renderCloudPlanItem({
        currentPlan: Plan.sandbox,
        plan: Plan.professional,
        planRange: PlanRange.monthly,
      })

      const button = screen.getByRole('button')
      await user.click(button)

      await waitFor(() => {
        expect(mockFetchSubscriptionUrls).toHaveBeenCalledWith(Plan.professional, 'month')
      })
    })

    it('should call fetchSubscriptionUrls with plan and "year" for yearly range', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({
        currentPlan: Plan.sandbox,
        plan: Plan.team,
        planRange: PlanRange.yearly,
      })

      const button = screen.getByRole('button')
      await user.click(button)

      await waitFor(() => {
        expect(mockFetchSubscriptionUrls).toHaveBeenCalledWith(Plan.team, 'year')
      })
    })

    it('should open invoice management for current paid plan', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({ currentPlan: Plan.professional, plan: Plan.professional })

      const button = screen.getByRole('button')
      await user.click(button)

      await waitFor(() => {
        expect(mockOpenAsyncWindow).toHaveBeenCalled()
      })
      // Should NOT call fetchSubscriptionUrls (invoice, not subscription)
      expect(mockFetchSubscriptionUrls).not.toHaveBeenCalled()
    })

    it('should not do anything when clicking on sandbox free plan button', async () => {
      const user = userEvent.setup()
      renderCloudPlanItem({ currentPlan: Plan.sandbox, plan: Plan.sandbox })

      const button = screen.getByRole('button')
      await user.click(button)

      // Wait a tick and verify no actions were taken
      await waitFor(() => {
        expect(mockFetchSubscriptionUrls).not.toHaveBeenCalled()
        expect(mockOpenAsyncWindow).not.toHaveBeenCalled()
      })
    })
  })

  // ─── 5. Permission Check ────────────────────────────────────────────────
  describe('Permission check', () => {
    it('should show error toast when non-manager clicks upgrade button', async () => {
      setupAppContext({ isCurrentWorkspaceManager: false })
      const user = userEvent.setup()
      renderCloudPlanItem({ currentPlan: Plan.sandbox, plan: Plan.professional })

      const button = screen.getByRole('button')
      await user.click(button)

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
      // Should not proceed with payment
      expect(mockFetchSubscriptionUrls).not.toHaveBeenCalled()
    })
  })
})
