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
let mockEducationStatus = { is_student: false, can_redeem_discount: false }
let mockCurrentPlan: CloudPlan = 'sandbox'
let mockEducationEnabled = false
const navigateToCheckout = vi.fn()
const mockGetSubscription = vi.hoisted(() => vi.fn())

const render = async (ui: React.ReactElement) => {
  const { queryClient, wrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
const setupContexts = (
  planOverrides: { type?: CloudPlan } = {},
  appOverrides: Record<string, unknown> = {},
) => {
  mockEducationStatus = { is_student: false, can_redeem_discount: false }
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
    await user.click(screen.getByRole('radio', { name: /billing\.pricing\.annually/ }))
    expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'View pricing' }))
    expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).not.toBeChecked()
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

      await user.click(
        screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' }),
      )

      await waitFor(() => {
        expect(mockGetSubscription).toHaveBeenCalledWith(
          { query: { plan: 'professional', interval: 'month' } },
          { context: { silent: true } },
        )
        expect(navigateToCheckout).toHaveBeenCalledWith('https://pay.example.com')
      })
    })

    it('should default education account managers to yearly checkout', async () => {
      setupContexts()
      mockEducationEnabled = true
      mockEducationStatus = { is_student: true, can_redeem_discount: true }
      const user = userEvent.setup()
      await render(<Pricing />)

      expect(screen.getByRole('radio', { name: /billing\.pricing\.annually/ })).toBeChecked()

      await user.click(screen.getByRole('button', { name: 'education.useEducationDiscount' }))

      await waitFor(() => {
        expect(mockGetSubscription).toHaveBeenCalledWith(
          { query: { plan: 'professional', interval: 'year' } },
          { context: { silent: true } },
        )
        expect(navigateToCheckout).toHaveBeenCalledWith('https://pay.example.com')
      })
    })

    it('offers ordinary checkout in Sandbox after a student redeems in another workspace', async () => {
      mockEducationEnabled = true
      mockEducationStatus = { is_student: true, can_redeem_discount: false }
      const user = userEvent.setup()
      await render(<Pricing />)

      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
      expect(screen.getByRole('radio', { name: 'billing.pricing.monthly' })).toBeChecked()
      await user.click(screen.getByRole('radio', { name: /billing\.pricing\.annually/ }))
      expect(
        screen.getByRole('button', { name: 'billing.plansCommon.upgradeToProfessional' }),
      ).toBeEnabled()
      expect(
        screen.queryByText('education.planNotSupportEducationDiscount'),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'billing.plansCommon.upgradeToTeam' }))
      expect(
        screen.queryByRole('dialog', { name: 'education.educationPricingConfirm.title' }),
      ).not.toBeInTheDocument()
      await waitFor(() =>
        expect(navigateToCheckout).toHaveBeenCalledWith('https://pay.example.com'),
      )
      expect(mockGetSubscription).toHaveBeenCalledWith(
        { query: { plan: 'team', interval: 'year' } },
        { context: { silent: true } },
      )
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

    it('shows only the Professional popularity badge for Sandbox workspaces', async () => {
      setupContexts({ type: 'sandbox' })
      await render(<Pricing />)

      expect(
        screen.queryByRole('button', { name: 'billing.plansCommon.startForFree' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('billing.plansCommon.currentPlan')).not.toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.mostPopular')).toBeVisible()
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
