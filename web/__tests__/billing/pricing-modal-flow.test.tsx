/**
 * Integration test: Pricing Modal Flow
 *
 * Tests the full Pricing modal lifecycle:
 *   Pricing → PricingContent (category + billing interval) → cloud / self-hosted plans
 *   → CloudPlanItem / SelfHostedPlanItem → Footer
 *
 * Validates cross-component state propagation when the user switches between
 * cloud / self-hosted categories and monthly / yearly plan ranges.
 */
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { ALL_PLANS } from '@/app/components/billing/config'
import { Pricing } from '@/app/components/billing/pricing'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'

function PricingEntry() {
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  return <button onClick={() => setPricing('open')}>View pricing</button>
}

// ─── Mock state ──────────────────────────────────────────────────────────────
let mockConsoleState: Record<string, unknown> = {}
let mockEducationStatus = { is_student: false, allow_refresh: false, expire_at: null }
let mockCurrentPlan: CloudPlan = 'sandbox'
let mockEducationEnabled = false
const navigateToCheckout = vi.fn()
const mockGetSubscription = vi.hoisted(() => vi.fn())

const render = async (ui: React.ReactElement) => {
  const { queryClient, wrapper } = createConsoleQueryWrapper({
    accountProfile: mockConsoleState.userProfile as { email?: string },
    accountProfileMeta: { currentVersion: '1.0.0' },
    educationStatus: mockEducationStatus,
  })
  seedFeatures(queryClient, {
    billing: {
      subscription: { interval: 'month', plan: mockCurrentPlan },
    },
    education: { enabled: mockEducationEnabled },
  })
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper({ searchParams: '?pricing=open' })
  const result = renderWithConsoleState(<NuqsWrapper>{ui}</NuqsWrapper>, { wrapper })
  await screen.findByRole('heading', { name: 'billing.plans.sandbox.name' })
  return result
}

// ─── Context mocks ───────────────────────────────────────────────────────────
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleClient: new Proxy(actual.consoleClient, {
      get(target, prop, receiver) {
        if (prop === 'billing') {
          return {
            invoices: {
              get: vi.fn().mockResolvedValue({ url: 'https://invoice.example.com' }),
            },
            subscription: { get: mockGetSubscription },
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    }),
  }
})

// ─── Navigation mocks ───────────────────────────────────────────────────────
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}))

// Self-hosted List uses t() with returnObjects which returns string in mock;
// mock it to avoid deep i18n dependency (unit tests cover this component)
vi.mock('@/app/components/billing/pricing/plans/self-hosted-plan-item/list', () => ({
  SelfHostedPlanFeatures: () => null,
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────
const setupContexts = (
  planOverrides: { type?: CloudPlan } = {},
  appOverrides: Record<string, unknown> = {},
) => {
  mockEducationStatus = { is_student: false, allow_refresh: false, expire_at: null }
  mockCurrentPlan = planOverrides.type ?? 'sandbox'
  mockEducationEnabled = false
  mockConsoleState = {
    isCurrentWorkspaceManager: true,
    userProfile: { email: 'test@example.com' },
    langGeniusVersionInfo: { current_version: '1.0.0' },
    ...appOverrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('Pricing Modal Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    vi.spyOn(window.location, 'href', 'set').mockImplementation(navigateToCheckout)
    vi.spyOn(window, 'open').mockReturnValue(null)
    mockGetSubscription.mockResolvedValue({ url: 'https://pay.example.com' })
    setupContexts()
  })

  afterEach(() => vi.restoreAllMocks())

  it('starts a new pricing session after closing and reopening', async () => {
    const user = userEvent.setup()
    await render(
      <>
        <PricingEntry />
        <Pricing />
      </>,
    )
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toBeChecked()
    await user.click(screen.getByRole('tab', { name: 'billing.plansCommon.self' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'View pricing' }))
    expect(await screen.findByRole('tab', { name: 'billing.plansCommon.cloud' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  // ─── 1. Initial Rendering ────────────────────────────────────────────────
  describe('Initial rendering', () => {
    it('should default to cloud category with three cloud plans', async () => {
      await render(<Pricing />)

      expect(screen.getByRole('tab', { name: 'billing.plansCommon.cloud' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByRole('tab', { name: 'billing.plansCommon.self' })).toHaveAttribute(
        'aria-selected',
        'false',
      )
      expect(
        screen.getByRole('tablist', { name: 'billing.plansCommon.title.plans' }),
      ).toBeInTheDocument()

      // Three cloud plans: sandbox, professional, team
      expect(screen.getByText(/plans\.sandbox\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.professional\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.team\.name/i)).toBeInTheDocument()
    })
  })

  it('tabs directly into the category controls and then the plan panel', async () => {
    const user = userEvent.setup()
    await render(<Pricing />)
    screen.getByRole('button', { name: 'common.operation.close' }).focus()
    await user.tab()
    expect(screen.getByRole('tab', { name: 'billing.plansCommon.cloud' })).toHaveFocus()
    await user.tab()
    expect(
      screen.getByRole('switch', { name: /billing\.plansCommon\.annualBilling/ }),
    ).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('tabpanel', { name: 'billing.plansCommon.cloud' })).toHaveFocus()
  })

  // ─── 2. Category Switching ───────────────────────────────────────────────
  describe('Category switching', () => {
    it('allows arrow navigation before activating a category with Enter', async () => {
      const user = userEvent.setup()
      await render(<Pricing />)

      expect(screen.getByText('billing.plansCommon.taxTip')).toBeInTheDocument()
      const cloudTab = screen.getByRole('tab', { name: 'billing.plansCommon.cloud' })
      const selfHostedTab = screen.getByRole('tab', { name: 'billing.plansCommon.self' })
      cloudTab.focus()
      await user.keyboard('{ArrowRight}')
      expect(selfHostedTab).toHaveFocus()
      expect(cloudTab).toHaveAttribute('aria-selected', 'true')
      await user.keyboard('{Enter}')
      await screen.findByRole('heading', { name: 'billing.plans.community.name' })

      expect(selfHostedTab).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(screen.queryByText('billing.plansCommon.taxTip')).not.toBeInTheDocument()

      // Self-hosted plans should appear
      expect(screen.getByText(/plans\.community\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.premium\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.enterprise\.name/i)).toBeInTheDocument()

      // Cloud plans should disappear
      expect(screen.queryByText(/plans\.sandbox\.name/i)).not.toBeInTheDocument()
    })

    it('should switch back to cloud plans when clicking cloud tab', async () => {
      const user = userEvent.setup()
      await render(<Pricing />)

      // Switch to self-hosted
      await user.click(screen.getByRole('tab', { name: 'billing.plansCommon.self' }))
      expect(screen.queryByText(/plans\.sandbox\.name/i)).not.toBeInTheDocument()

      // Switch back to cloud
      await user.click(screen.getByRole('tab', { name: 'billing.plansCommon.cloud' }))
      expect(screen.getByText(/plans\.sandbox\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plansCommon\.annualBilling/i)).toBeInTheDocument()
    })
  })

  // ─── 3. Plan Range Switching (Monthly ↔ Yearly) ──────────────────────────
  describe('Plan range switching', () => {
    it('should show monthly prices by default', async () => {
      await render(<Pricing />)

      // Professional monthly price: $59
      const proPriceStr = `$${ALL_PLANS.professional.price}`
      expect(screen.getByText(proPriceStr)).toBeInTheDocument()

      // Team monthly price: $159
      const teamPriceStr = `$${ALL_PLANS.team.price}`
      expect(screen.getByText(teamPriceStr)).toBeInTheDocument()
    })
  })

  // ─── 4. Cloud Plan Button States ─────────────────────────────────────────
  describe('Cloud plan button states', () => {
    it('should allow managers without billing permission keys to change plans', async () => {
      const user = userEvent.setup()
      await render(<Pricing />)

      await user.click(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' }))

      await waitFor(() => {
        expect(mockGetSubscription).toHaveBeenCalledWith({
          query: { plan: 'professional', interval: 'month' },
        })
        expect(navigateToCheckout).toHaveBeenCalledWith('https://pay.example.com')
      })
    })

    it('should default education account managers to yearly checkout', async () => {
      setupContexts()
      mockEducationEnabled = true
      mockEducationStatus.is_student = true
      const user = userEvent.setup()
      await render(<Pricing />)

      expect(
        screen.getByRole('switch', { name: /billing\.plansCommon\.annualBilling/ }),
      ).toBeChecked()

      await user.click(screen.getByRole('button', { name: 'education.useEducationDiscount' }))

      await waitFor(() => {
        expect(mockGetSubscription).toHaveBeenCalledWith({
          query: { plan: 'professional', interval: 'year' },
        })
        expect(navigateToCheckout).toHaveBeenCalledWith('https://pay.example.com')
      })
    })

    it('should block non-manager members even when billing permission keys are present', async () => {
      setupContexts(
        {},
        {
          isCurrentWorkspaceManager: false,
          workspacePermissionKeys: ['billing.manage', 'billing.subscription.manage'],
        },
      )
      const user = userEvent.setup()
      await render(<Pricing />)

      await user.click(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' }))

      expect(mockGetSubscription).not.toHaveBeenCalled()
      expect(window.open).not.toHaveBeenCalled()
    })

    it('should show "Current Plan" for the current plan (sandbox)', async () => {
      setupContexts({ type: 'sandbox' })
      await render(<Pricing />)

      expect(screen.getByText(/plansCommon\.currentPlan/i)).toBeInTheDocument()
    })
  })

  // ─── 5. Self-Hosted Plan Details ─────────────────────────────────────────
  describe('Self-hosted plan details', () => {
    it('should show "coming soon" text for premium plan cloud providers', async () => {
      const user = userEvent.setup()
      await render(<Pricing />)

      await user.click(screen.getByText(/plansCommon\.self/i))

      expect(screen.getByText(/plans\.premium\.comingSoon/i)).toBeInTheDocument()
    })
  })

  // ─── 6. Pricing URL ─────────────────────────────────────────────────────
  describe('Pricing page URL', () => {
    it('should render pricing link with correct URL', async () => {
      await render(<Pricing />)

      const link = screen.getByRole('link', { name: /plansCommon\.comparePlanAndFeatures/i })
      expect(link).toHaveAttribute('href', 'https://dify.ai/pricing/dify-cloud#compare')
    })
  })
})
