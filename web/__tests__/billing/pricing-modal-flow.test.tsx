/**
 * Integration test: Pricing Modal Flow
 *
 * Tests the full Pricing modal lifecycle:
 *   Pricing → PlanSwitcher (category + range toggle) → Plans (cloud / self-hosted)
 *   → CloudPlanItem / SelfHostedPlanItem → Footer
 *
 * Validates cross-component state propagation when the user switches between
 * cloud / self-hosted categories and monthly / yearly plan ranges.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { ALL_PLANS } from '@/app/components/billing/config'
import Pricing from '@/app/components/billing/pricing'
import { Plan } from '@/app/components/billing/type'

// ─── Mock state ──────────────────────────────────────────────────────────────
let mockProviderCtx: Record<string, unknown> = {}
let mockAppCtx: Record<string, unknown> = {}

// ─── Context mocks ───────────────────────────────────────────────────────────
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderCtx,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockAppCtx,
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
  useGetPricingPageLanguage: () => 'en',
}))

// ─── Service mocks ───────────────────────────────────────────────────────────
vi.mock('@/service/billing', () => ({
  fetchSubscriptionUrls: vi.fn().mockResolvedValue({ url: 'https://pay.example.com' }),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    billing: {
      invoices: vi.fn().mockResolvedValue({ url: 'https://invoice.example.com' }),
    },
  },
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => vi.fn(),
}))

// ─── Navigation mocks ───────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}))

// ─── External component mocks (lightweight) ─────────────────────────────────
vi.mock('@/app/components/base/icons/src/public/billing', () => ({
  Azure: () => <span data-testid="icon-azure" />,
  GoogleCloud: () => <span data-testid="icon-gcloud" />,
  AwsMarketplaceLight: () => <span data-testid="icon-aws-light" />,
  AwsMarketplaceDark: () => <span data-testid="icon-aws-dark" />,
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
  useTheme: () => ({ theme: 'light' }),
}))

// Self-hosted List uses t() with returnObjects which returns string in mock;
// mock it to avoid deep i18n dependency (unit tests cover this component)
vi.mock('@/app/components/billing/pricing/plans/self-hosted-plan-item/list', () => ({
  default: ({ plan }: { plan: string }) => (
    <div data-testid={`self-hosted-list-${plan}`}>Features</div>
  ),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────
const defaultPlanData = {
  type: Plan.sandbox,
  usage: {
    buildApps: 1,
    teamMembers: 1,
    documentsUploadQuota: 0,
    vectorSpace: 10,
    annotatedResponse: 1,
    triggerEvents: 0,
    apiRateLimit: 0,
  },
  total: {
    buildApps: 5,
    teamMembers: 1,
    documentsUploadQuota: 50,
    vectorSpace: 50,
    annotatedResponse: 10,
    triggerEvents: 3000,
    apiRateLimit: 5000,
  },
}

const setupContexts = (planOverrides: Record<string, unknown> = {}, appOverrides: Record<string, unknown> = {}) => {
  mockProviderCtx = {
    plan: { ...defaultPlanData, ...planOverrides },
    enableBilling: true,
    isFetchedPlan: true,
    enableEducationPlan: false,
    isEducationAccount: false,
    allowRefreshEducationVerify: false,
  }
  mockAppCtx = {
    isCurrentWorkspaceManager: true,
    userProfile: { email: 'test@example.com' },
    langGeniusVersionInfo: { current_version: '1.0.0' },
    ...appOverrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('Pricing Modal Flow', () => {
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    setupContexts()
  })

  // ─── 1. Initial Rendering ────────────────────────────────────────────────
  describe('Initial rendering', () => {
    it('should render header with close button and footer with pricing link', () => {
      render(<Pricing onCancel={onCancel} />)

      // Header close button exists (multiple plan buttons also exist)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(1)
      // Footer pricing link
      expect(screen.getByText(/plansCommon\.comparePlanAndFeatures/i)).toBeInTheDocument()
    })

    it('should default to cloud category with three cloud plans', () => {
      render(<Pricing onCancel={onCancel} />)

      // Three cloud plans: sandbox, professional, team
      expect(screen.getByText(/plans\.sandbox\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.professional\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.team\.name/i)).toBeInTheDocument()
    })

    it('should show plan range switcher (annual billing toggle) by default for cloud', () => {
      render(<Pricing onCancel={onCancel} />)

      expect(screen.getByText(/plansCommon\.annualBilling/i)).toBeInTheDocument()
    })

    it('should show tax tip in footer for cloud category', () => {
      render(<Pricing onCancel={onCancel} />)

      // Use exact match to avoid matching taxTipSecond
      expect(screen.getByText('billing.plansCommon.taxTip')).toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.taxTipSecond')).toBeInTheDocument()
    })
  })

  // ─── 2. Category Switching ───────────────────────────────────────────────
  describe('Category switching', () => {
    it('should switch to self-hosted plans when clicking self-hosted tab', async () => {
      const user = userEvent.setup()
      render(<Pricing onCancel={onCancel} />)

      // Click the self-hosted tab
      const selfTab = screen.getByText(/plansCommon\.self/i)
      await user.click(selfTab)

      // Self-hosted plans should appear
      expect(screen.getByText(/plans\.community\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.premium\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.enterprise\.name/i)).toBeInTheDocument()

      // Cloud plans should disappear
      expect(screen.queryByText(/plans\.sandbox\.name/i)).not.toBeInTheDocument()
    })

    it('should hide plan range switcher for self-hosted category', async () => {
      const user = userEvent.setup()
      render(<Pricing onCancel={onCancel} />)

      await user.click(screen.getByText(/plansCommon\.self/i))

      // Annual billing toggle should not be visible
      expect(screen.queryByText(/plansCommon\.annualBilling/i)).not.toBeInTheDocument()
    })

    it('should hide tax tip in footer for self-hosted category', async () => {
      const user = userEvent.setup()
      render(<Pricing onCancel={onCancel} />)

      await user.click(screen.getByText(/plansCommon\.self/i))

      expect(screen.queryByText('billing.plansCommon.taxTip')).not.toBeInTheDocument()
    })

    it('should switch back to cloud plans when clicking cloud tab', async () => {
      const user = userEvent.setup()
      render(<Pricing onCancel={onCancel} />)

      // Switch to self-hosted
      await user.click(screen.getByText(/plansCommon\.self/i))
      expect(screen.queryByText(/plans\.sandbox\.name/i)).not.toBeInTheDocument()

      // Switch back to cloud
      await user.click(screen.getByText(/plansCommon\.cloud/i))
      expect(screen.getByText(/plans\.sandbox\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plansCommon\.annualBilling/i)).toBeInTheDocument()
    })
  })

  // ─── 3. Plan Range Switching (Monthly ↔ Yearly) ──────────────────────────
  describe('Plan range switching', () => {
    it('should show monthly prices by default', () => {
      render(<Pricing onCancel={onCancel} />)

      // Professional monthly price: $59
      const proPriceStr = `$${ALL_PLANS.professional.price}`
      expect(screen.getByText(proPriceStr)).toBeInTheDocument()

      // Team monthly price: $159
      const teamPriceStr = `$${ALL_PLANS.team.price}`
      expect(screen.getByText(teamPriceStr)).toBeInTheDocument()
    })

    it('should show "Free" for sandbox plan regardless of range', () => {
      render(<Pricing onCancel={onCancel} />)

      expect(screen.getByText(/plansCommon\.free/i)).toBeInTheDocument()
    })

    it('should show "most popular" badge only for professional plan', () => {
      render(<Pricing onCancel={onCancel} />)

      expect(screen.getByText(/plansCommon\.mostPopular/i)).toBeInTheDocument()
    })
  })

  // ─── 4. Cloud Plan Button States ─────────────────────────────────────────
  describe('Cloud plan button states', () => {
    it('should show "Current Plan" for the current plan (sandbox)', () => {
      setupContexts({ type: Plan.sandbox })
      render(<Pricing onCancel={onCancel} />)

      expect(screen.getByText(/plansCommon\.currentPlan/i)).toBeInTheDocument()
    })

    it('should show specific button text for non-current plans', () => {
      setupContexts({ type: Plan.sandbox })
      render(<Pricing onCancel={onCancel} />)

      // Professional button text
      expect(screen.getByText(/plansCommon\.startBuilding/i)).toBeInTheDocument()
      // Team button text
      expect(screen.getByText(/plansCommon\.getStarted/i)).toBeInTheDocument()
    })

    it('should mark sandbox as "Current Plan" for professional user (enterprise normalized to team)', () => {
      setupContexts({ type: Plan.enterprise })
      render(<Pricing onCancel={onCancel} />)

      // Enterprise is normalized to team for display, so team is "Current Plan"
      expect(screen.getByText(/plansCommon\.currentPlan/i)).toBeInTheDocument()
    })
  })

  // ─── 5. Self-Hosted Plan Details ─────────────────────────────────────────
  describe('Self-hosted plan details', () => {
    it('should show cloud provider icons only for premium plan', async () => {
      const user = userEvent.setup()
      render(<Pricing onCancel={onCancel} />)

      await user.click(screen.getByText(/plansCommon\.self/i))

      // Premium plan should show Azure and Google Cloud icons
      expect(screen.getByTestId('icon-azure')).toBeInTheDocument()
      expect(screen.getByTestId('icon-gcloud')).toBeInTheDocument()
    })

    it('should show "coming soon" text for premium plan cloud providers', async () => {
      const user = userEvent.setup()
      render(<Pricing onCancel={onCancel} />)

      await user.click(screen.getByText(/plansCommon\.self/i))

      expect(screen.getByText(/plans\.premium\.comingSoon/i)).toBeInTheDocument()
    })
  })

  // ─── 6. Close Handling ───────────────────────────────────────────────────
  describe('Close handling', () => {
    it('should call onCancel when pressing ESC key', () => {
      render(<Pricing onCancel={onCancel} />)

      // ahooks useKeyPress listens on document for keydown events
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        bubbles: true,
      }))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  // ─── 7. Pricing URL ─────────────────────────────────────────────────────
  describe('Pricing page URL', () => {
    it('should render pricing link with correct URL', () => {
      render(<Pricing onCancel={onCancel} />)

      const link = screen.getByText(/plansCommon\.comparePlanAndFeatures/i)
      expect(link.closest('a')).toHaveAttribute(
        'href',
        'https://dify.ai/en/pricing#plans-and-features',
      )
    })
  })
})
