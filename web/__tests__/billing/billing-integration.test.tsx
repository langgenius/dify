import type {
  GetFeaturesResponse,
  GetFeaturesVectorSpaceResponse,
} from '@dify/contracts/api/console/features/types.gen'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { DeepPartial } from '@/test/console/system-features'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import * as React from 'react'
import AnnotationFull from '@/app/components/billing/annotation-full'
import AnnotationFullModal from '@/app/components/billing/annotation-full/modal'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import Billing from '@/app/components/billing/billing-page'
import { NUM_INFINITE } from '@/app/components/billing/config'
import PlanComp from '@/app/components/billing/plan'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import PriorityLabel from '@/app/components/billing/priority-label'
import TriggerEventsLimitModal from '@/app/components/billing/trigger-events-limit-modal'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedEducationStatus,
} from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

let mockFeatures: DeepPartial<GetFeaturesResponse> = {}
let mockVectorSpace: GetFeaturesVectorSpaceResponse = { size: 0, limit: 50, usage_unknown: false }
let mockConsoleState: Record<string, unknown> = {}
let mockEducationStatus = { is_student: false, allow_refresh: false, expire_at: null }

const renderWithoutPricing = (
  ui: ReactElement,
  options: RenderOptions = {},
  vectorSpaceUsageUnknown = false,
) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryOptions().queryKey, {
    ...mockVectorSpace,
    usage_unknown: vectorSpaceUsageUnknown,
  })
  queryClient.setQueryData(consoleQuery.billing.invoices.get.queryOptions().queryKey, {
    url: 'https://billing.example.com',
  })
  seedEducationStatus(queryClient, mockEducationStatus)
  const { wrapper } = createConsoleQueryWrapper({
    accountProfile: mockConsoleState.userProfile as { email?: string },
    accountProfileMeta: { currentVersion: '1.0.0' },
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: mockFeatures,
    queryClient,
  })
  return renderWithConsoleState(ui, { ...options, wrapper })
}

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
  useLocale: () => 'en-US',
}))

// ─── Navigation mocks ───────────────────────────────────────────────────────
const mockRouterPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/components/header/utils/util', () => ({
  mailToSupport: () => 'mailto:support@test.com',
}))

// ─── Test data factories ────────────────────────────────────────────────────
type BillingOverrides = DeepPartial<GetFeaturesResponse> & {
  vectorSpace?: Partial<GetFeaturesVectorSpaceResponse>
}

const setupBilling = (
  { vectorSpace, ...features }: BillingOverrides = {},
  education: { enableEducationPlan?: boolean } = {},
  educationStatus: Partial<typeof mockEducationStatus> = {},
) => {
  mockEducationStatus = {
    is_student: false,
    allow_refresh: false,
    expire_at: null,
    ...educationStatus,
  }
  mockFeatures = { ...features, education: { enabled: education.enableEducationPlan ?? false } }
  mockVectorSpace = { size: 0, limit: 50, usage_unknown: false, ...vectorSpace }
}

const setupConsoleState = (overrides: Record<string, unknown> = {}) => {
  mockConsoleState = {
    isCurrentWorkspaceManager: true,
    workspacePermissionKeys: [],
    userProfile: { email: 'test@example.com' },
    langGeniusVersionInfo: { current_version: '1.0.0' },
    ...overrides,
  }
}

// Vitest hoists vi.mock() calls, so imports above will use mocked modules

// ═══════════════════════════════════════════════════════════════════════════
// 1. Billing Page + Plan Component Integration
// Tests the full data flow: BillingPage → PlanComp → UsageInfo → ProgressBar
// ═══════════════════════════════════════════════════════════════════════════
function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('Billing Page + Plan Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

  // Verify that the billing page renders PlanComp with all 7 usage items
  describe('Rendering complete plan information', () => {
    it('should display all 7 usage metrics for sandbox plan', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        apps: { size: 3, limit: 5 },
        members: { size: 1, limit: 1 },
        documents_upload_quota: { size: 10, limit: 50 },
        annotation_quota_limit: { size: 5, limit: 10 },
        trigger_event: { usage: 1000, limit: 3000 },
        api_rate_limit: { usage: 2000, limit: 5000 },
        vectorSpace: { size: 20, limit: 50 },
      })

      render(<Billing />)

      // Plan name
      expect(screen.getByText(/plans\.sandbox\.name/i)).toBeInTheDocument()

      // All 7 usage items should be visible
      expect(screen.getByText(/usagePage\.buildApps/i)).toBeInTheDocument()
      expect(screen.getByText(/usagePage\.teamMembers/i)).toBeInTheDocument()
      expect(screen.getByText(/usagePage\.documentsUploadQuota/i)).toBeInTheDocument()
      expect(screen.getByText(/usagePage\.vectorSpace/i)).toBeInTheDocument()
      expect(screen.getByText(/usagePage\.annotationQuota/i)).toBeInTheDocument()
      expect(screen.getByText(/usagePage\.triggerEvents/i)).toBeInTheDocument()
      expect(screen.getByText(/plansCommon\.apiRateLimit/i)).toBeInTheDocument()
    })

    it('should expose each quota card and its value through stable semantics', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        members: { size: 3, limit: 5 },
      })

      render(<PlanComp loc="test" />)

      const quotaCard = screen.getByRole('group', { name: /usagePage\.teamMembers/i })
      const quotaLabel = within(quotaCard).getByText(/usagePage\.teamMembers/i)
      const quotaValue = within(quotaCard).getByTestId('billing-quota-value')

      expect(quotaLabel.tagName).toBe('DT')
      expect(quotaValue.tagName).toBe('DD')
      expect(quotaValue).toHaveTextContent(/3\s*\/\s*5/)
    })

    it('should display unknown vector space usage as a placeholder', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        vectorSpace: { size: 0, limit: 50 },
      })

      render(<PlanComp loc="test" />, {}, true)

      const quotaCard = screen.getByRole('group', { name: /usagePage\.vectorSpace/i })
      const quotaValue = within(quotaCard).getByTestId('billing-quota-value')
      expect(quotaValue).toHaveTextContent('--')
      expect(quotaValue).not.toHaveTextContent('< 50')
    })

    it('should show "unlimited" for infinite quotas (professional API rate limit)', () => {
      setupBilling({
        billing: { subscription: { plan: 'professional' } },
        api_rate_limit: { limit: NUM_INFINITE },
      })

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/plansCommon\.unlimited/i)).toBeInTheDocument()
    })

    it('should display reset days for trigger events when applicable', () => {
      setupBilling({
        billing: { subscription: { plan: 'professional' } },
        trigger_event: { limit: 20000, reset_date: dayjs().add(7, 'day').startOf('day').unix() },
      })

      render(<PlanComp loc="test" />)

      // Reset text should be visible
      expect(screen.getByText(/usagePage\.resetsIn/i)).toBeInTheDocument()
    })
  })

  // Verify billing URL button visibility and behavior
  describe('Billing URL button', () => {
    it('should show billing button to managers without billing permission keys', () => {
      setupBilling({ billing: { subscription: { plan: 'sandbox' } } })
      setupConsoleState({
        isCurrentWorkspaceManager: true,
        workspacePermissionKeys: [],
      })

      render(<Billing />)

      expect(screen.getByText(/viewBillingTitle/i)).toBeInTheDocument()
      expect(screen.getByText(/viewBillingAction/i)).toBeInTheDocument()
    })

    it('should hide billing button from non-manager members', () => {
      setupBilling({ billing: { subscription: { plan: 'sandbox' } } })
      setupConsoleState({
        isCurrentWorkspaceManager: false,
      })

      render(<Billing />)

      expect(screen.queryByText(/viewBillingTitle/i)).not.toBeInTheDocument()
    })

    it('should show billing button when a manager has no billing permission keys', () => {
      setupBilling({ billing: { subscription: { plan: 'sandbox' } } })
      setupConsoleState({
        isCurrentWorkspaceManager: true,
        workspacePermissionKeys: [],
      })

      render(<Billing />)

      expect(screen.getByText(/viewBillingTitle/i)).toBeInTheDocument()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Plan Type Display Integration
// Tests that different plan types render correct visual elements
// ═══════════════════════════════════════════════════════════════════════════
describe('Plan Type Display Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

  it('should render sandbox plan with upgrade button (premium badge)', () => {
    setupBilling({ billing: { subscription: { plan: 'sandbox' } } })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/plans\.sandbox\.name/i)).toBeInTheDocument()
    expect(screen.getByText(/plans\.sandbox\.for/i)).toBeInTheDocument()
    // Sandbox shows premium badge upgrade button (not plain)
    expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
  })

  it('should render professional plan with plain upgrade button', () => {
    setupBilling({ billing: { subscription: { plan: 'professional' } } })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/plans\.professional\.name/i)).toBeInTheDocument()
    // Professional shows plain button because it's not team
    expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
  })

  it('should render team plan with plain-style upgrade button', () => {
    setupBilling({ billing: { subscription: { plan: 'team' } } })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/plans\.team\.name/i)).toBeInTheDocument()
    // Team plan has isPlain=true, so shows "upgradeBtn.plain" text
    expect(screen.getByText(/upgradeBtn\.plain/i)).toBeInTheDocument()
  })

  it('should show education verify button when enableEducationPlan is true and not yet verified', () => {
    setupBilling({ billing: { subscription: { plan: 'sandbox' } } }, { enableEducationPlan: true })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
  })

  it('should show education discount to managers without billing permission keys', () => {
    setupBilling(
      { billing: { subscription: { plan: 'sandbox' } } },
      { enableEducationPlan: true },
      { is_student: true },
    )
    setupConsoleState({ isCurrentWorkspaceManager: true, workspacePermissionKeys: [] })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/useEducationDiscount/i)).toBeInTheDocument()
  })

  it('should hide education discount from non-manager members', () => {
    setupBilling(
      { billing: { subscription: { plan: 'sandbox' } } },
      { enableEducationPlan: true },
      { is_student: true },
    )
    setupConsoleState({
      isCurrentWorkspaceManager: false,
      workspacePermissionKeys: ['billing.manage'],
    })

    render(<PlanComp loc="test" />)

    expect(screen.queryByText(/useEducationDiscount/i)).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Upgrade Flow Integration
// Tests the flow: UpgradeBtn click → pricing URL
// and PlanUpgradeModal → close + trigger pricing
// ═══════════════════════════════════════════════════════════════════════════
describe('Upgrade Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
    setupBilling({ billing: { subscription: { plan: 'sandbox' } } })
  })

  // UpgradeBtn triggers pricing modal
  describe('UpgradeBtn triggers pricing modal', () => {
    it('should open pricing when clicking premium badge upgrade button', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn />)

      const badgeText = screen.getByText(/upgradeBtn\.encourage/i)
      await user.click(badgeText)

      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })

    it('should open pricing when clicking plain upgrade button', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn isPlain />)

      const button = screen.getByRole('button')
      await user.click(button)

      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })

    it('should use custom onClick when provided instead of opening pricing', async () => {
      const customOnClick = vi.fn()
      const user = userEvent.setup()

      render(<UpgradeBtn onClick={customOnClick} />)

      const badgeText = screen.getByText(/upgradeBtn\.encourage/i)
      await user.click(badgeText)

      expect(customOnClick).toHaveBeenCalledTimes(1)
      expect(onPricingUrlUpdate).not.toHaveBeenCalled()
    })

    it('should fire gtag event with loc parameter when clicked', async () => {
      const mockGtag = vi.fn()
      ;(window as unknown as Record<string, unknown>).gtag = mockGtag
      const user = userEvent.setup()

      render(<UpgradeBtn loc="billing-page" />)

      const badgeText = screen.getByText(/upgradeBtn\.encourage/i)
      await user.click(badgeText)

      expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', { loc: 'billing-page' })
      delete (window as unknown as Record<string, unknown>).gtag
    })
  })

  // PlanUpgradeModal integration: close modal and trigger pricing
  describe('PlanUpgradeModal upgrade flow', () => {
    it('should close the notice and open pricing when clicking upgrade button in modal', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(
        <PlanUpgradeModal
          show={true}
          onClose={onClose}
          title="Upgrade Required"
          description="You need a better plan"
        />,
      )

      // The modal should show title and description
      expect(screen.getByText('Upgrade Required')).toBeInTheDocument()
      expect(screen.getByText('You need a better plan')).toBeInTheDocument()

      // Click the upgrade button inside the modal
      const upgradeText = screen.getByText(/triggerLimitModal\.upgrade/i)
      await user.click(upgradeText)

      // Should close the current modal first
      expect(onClose).toHaveBeenCalledTimes(1)
      // Then open pricing modal
      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })

    it('should call onClose when clicking dismiss button', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(<PlanUpgradeModal show={true} onClose={onClose} title="Test" description="Test" />)

      const dismissBtn = screen.getByText(/triggerLimitModal\.dismiss/i)
      await user.click(dismissBtn)

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onPricingUrlUpdate).not.toHaveBeenCalled()
    })
  })

  // Upgrade from PlanComp: clicking upgrade button in plan component triggers pricing
  describe('PlanComp upgrade button triggers pricing', () => {
    it('should open pricing modal when clicking upgrade in sandbox plan', async () => {
      const user = userEvent.setup()
      setupBilling({ billing: { subscription: { plan: 'sandbox' } } })

      render(<PlanComp loc="test-loc" />)

      const upgradeText = screen.getByText(/upgradeBtn\.encourageShort/i)
      await user.click(upgradeText)

      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Capacity Full Components Integration
// Tests AppsFull, VectorSpaceFull, AnnotationFull, TriggerEventsLimitModal
// with real child components (UsageInfo, ProgressBar, UpgradeBtn)
// ═══════════════════════════════════════════════════════════════════════════
describe('Capacity Full Components Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

  // AppsFull renders with correct messaging and components
  describe('AppsFull integration', () => {
    it('should display upgrade tip and upgrade button for sandbox plan at capacity', () => {
      setupBilling({ billing: { subscription: { plan: 'sandbox' } }, apps: { size: 5, limit: 5 } })

      render(<AppsFull loc="test" />)

      // Should show "full" tip
      expect(screen.getByText(/apps\.fullTip1$/i)).toBeInTheDocument()
      // Should show upgrade button
      expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
      // Should show usage/total fraction "5/5"
      expect(screen.getByText(/5\/5/)).toBeInTheDocument()
      // Should have an accessible meter rendered
      expect(screen.getByRole('meter', { name: /usagePage\.buildApps/i })).toBeInTheDocument()
    })

    it('should display upgrade tip and upgrade button for professional plan', () => {
      setupBilling({
        billing: { subscription: { plan: 'professional' } },
        apps: { size: 48, limit: 50 },
      })

      render(<AppsFull loc="test" />)

      expect(screen.getByText(/apps\.fullTip1$/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
    })

    it('should display contact tip and contact button for team plan', () => {
      setupBilling({ billing: { subscription: { plan: 'team' } }, apps: { size: 200, limit: 200 } })

      render(<AppsFull loc="test" />)

      // Team plan shows different tip
      expect(screen.getByText(/apps\.fullTip2$/i)).toBeInTheDocument()
      // Team plan shows "Contact Us" instead of upgrade
      expect(screen.getByText(/apps\.contactUs/i)).toBeInTheDocument()
      expect(screen.queryByText(/upgradeBtn\.encourageShort/i)).not.toBeInTheDocument()
    })

    it('should render progress bar with correct color based on usage percentage', () => {
      // 100% usage should show error color
      setupBilling({ billing: { subscription: { plan: 'sandbox' } }, apps: { size: 5, limit: 5 } })

      const { container } = render(<AppsFull loc="test" />)

      expect(container.querySelector('.bg-components-progress-error-progress')).toBeInTheDocument()
    })
  })

  // VectorSpaceFull renders with VectorSpaceInfo and UpgradeBtn
  describe('VectorSpaceFull integration', () => {
    it('should display full tip, upgrade button, and vector space usage info', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        vectorSpace: { size: 50, limit: 50 },
      })

      render(<VectorSpaceFull />)

      // Should show full tip
      expect(screen.getByText(/vectorSpace\.fullTip/i)).toBeInTheDocument()
      expect(screen.getByText(/vectorSpace\.fullSolution/i)).toBeInTheDocument()
      // Should show upgrade button
      expect(screen.getByText(/upgradeBtn\.encourage$/i)).toBeInTheDocument()
      // Should show vector space usage info
      expect(screen.getByText(/usagePage\.vectorSpace/i)).toBeInTheDocument()
    })
  })

  // AnnotationFull renders with Usage component and UpgradeBtn
  describe('AnnotationFull integration', () => {
    it('should display annotation full tip, upgrade button, and usage info', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        annotation_quota_limit: { size: 10, limit: 10 },
      })

      render(<AnnotationFull />)

      expect(screen.getByText(/annotatedResponse\.fullTipLine1/i)).toBeInTheDocument()
      expect(screen.getByText(/annotatedResponse\.fullTipLine2/i)).toBeInTheDocument()
      // UpgradeBtn rendered
      expect(screen.getByText(/upgradeBtn\.encourage$/i)).toBeInTheDocument()
      // Usage component should show annotation quota
      expect(screen.getByText(/annotatedResponse\.quotaTitle/i)).toBeInTheDocument()
    })
  })

  // AnnotationFullModal shows modal with usage and upgrade button
  describe('AnnotationFullModal integration', () => {
    it('should render modal with annotation info and upgrade button when show is true', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        annotation_quota_limit: { size: 10, limit: 10 },
      })

      render(<AnnotationFullModal show={true} onHide={vi.fn()} />)

      expect(screen.getByText(/annotatedResponse\.fullTipLine1/i)).toBeInTheDocument()
      expect(screen.getByText(/annotatedResponse\.quotaTitle/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourage$/i)).toBeInTheDocument()
    })

    it('should not render content when show is false', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        annotation_quota_limit: { size: 10, limit: 10 },
      })

      render(<AnnotationFullModal show={false} onHide={vi.fn()} />)

      expect(screen.queryByText(/annotatedResponse\.fullTipLine1/i)).not.toBeInTheDocument()
    })
  })

  // TriggerEventsLimitModal renders PlanUpgradeModal with embedded UsageInfo
  describe('TriggerEventsLimitModal integration', () => {
    it('should display trigger limit title, usage info, and upgrade button', () => {
      setupBilling({ billing: { subscription: { plan: 'professional' } } })

      render(
        <TriggerEventsLimitModal
          show={true}
          onClose={vi.fn()}
          usage={18000}
          total={20000}
          resetInDays={5}
        />,
      )

      // Modal title and description
      expect(screen.getByText(/triggerLimitModal\.title/i)).toBeInTheDocument()
      expect(screen.getByText(/triggerLimitModal\.description/i)).toBeInTheDocument()
      // Embedded UsageInfo with trigger events data
      expect(screen.getByText(/triggerLimitModal\.usageTitle/i)).toBeInTheDocument()
      expect(screen.getByText('18000')).toBeInTheDocument()
      expect(screen.getByText('20000')).toBeInTheDocument()
      // Reset info
      expect(screen.getByText(/usagePage\.resetsIn/i)).toBeInTheDocument()
      // Upgrade and dismiss buttons
      expect(screen.getByText(/triggerLimitModal\.upgrade/i)).toBeInTheDocument()
      expect(screen.getByText(/triggerLimitModal\.dismiss/i)).toBeInTheDocument()
    })

    it('closes the quota notice and opens pricing when upgrading', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      setupBilling({ billing: { subscription: { plan: 'professional' } } })

      render(<TriggerEventsLimitModal show={true} onClose={onClose} usage={20000} total={20000} />)

      const upgradeBtn = screen.getByText(/triggerLimitModal\.upgrade/i)
      await user.click(upgradeBtn)

      expect(onClose).toHaveBeenCalledTimes(1)
      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. PriorityLabel Integration
// Tests priority badge display for different plan types
// ═══════════════════════════════════════════════════════════════════════════
describe('PriorityLabel Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

  it('should display "standard" priority for sandbox plan', () => {
    setupBilling({ billing: { subscription: { plan: 'sandbox' } } })

    render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.standard/i)).toBeInTheDocument()
  })

  it('should display "priority" for professional plan with icon', () => {
    setupBilling({ billing: { subscription: { plan: 'professional' } } })

    const { container } = render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.priority/i)).toBeInTheDocument()
    // Professional plan should show the priority icon
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should display "top-priority" for team plan with icon', () => {
    setupBilling({ billing: { subscription: { plan: 'team' } } })

    const { container } = render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.top-priority/i)).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. Usage Display Edge Cases
// Tests storage mode, threshold logic, and progress bar color integration
// ═══════════════════════════════════════════════════════════════════════════
describe('Usage Display Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

  // Vector space storage mode behavior
  describe('VectorSpace storage mode in PlanComp', () => {
    it('should show "< 50" for sandbox plan with low vector space usage', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        vectorSpace: { size: 10, limit: 50 },
      })

      render(<PlanComp loc="test" />)

      // Storage mode: usage below threshold shows "< 50"
      expect(screen.getByText(/</)).toBeInTheDocument()
    })

    it('should show indeterminate progress bar for usage below threshold', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        vectorSpace: { size: 10, limit: 50 },
      })

      render(<PlanComp loc="test" />)

      // Below-threshold storage renders the redacted placeholder instead of a Meter
      expect(document.body.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
    })

    it('should show actual usage for pro plan above threshold', () => {
      setupBilling({
        billing: { subscription: { plan: 'professional' } },
        vectorSpace: { size: 1024, limit: 5120 },
      })

      render(<PlanComp loc="test" />)

      // Pro plan above threshold shows actual value
      expect(screen.getByText('1024')).toBeInTheDocument()
    })
  })

  // Progress bar color logic through real components
  describe('Progress bar color reflects usage severity', () => {
    it('should show normal color for low usage percentage', () => {
      setupBilling({ billing: { subscription: { plan: 'sandbox' } }, apps: { size: 1, limit: 5 } })

      const { container } = render(<PlanComp loc="test" />)

      // 20% usage — at least one Meter indicator should carry the neutral tone
      expect(
        container.querySelector('.bg-components-progress-bar-progress-solid'),
      ).toBeInTheDocument()
    })
  })

  // Reset days calculation in PlanComp
  describe('Reset days integration', () => {
    it('should not show reset for sandbox trigger events (no reset_date)', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        trigger_event: { limit: 3000, reset_date: 0 },
      })

      render(<PlanComp loc="test" />)

      // Find the trigger events section - should not have reset text
      const triggerSection = screen.getByText(/usagePage\.triggerEvents/i)
      const parent = triggerSection.closest('[class*="flex flex-col"]')
      // No reset text should appear (sandbox doesn't show reset for triggerEvents)
      expect(parent?.textContent).not.toContain('usagePage.resetsIn')
    })

    it('should show reset for professional trigger events with reset date', () => {
      setupBilling({
        billing: { subscription: { plan: 'professional' } },
        trigger_event: { limit: 20000, reset_date: dayjs().add(14, 'day').startOf('day').unix() },
      })

      render(<PlanComp loc="test" />)

      // Professional plan with finite triggerEvents should show reset
      const resetTexts = screen.getAllByText(/usagePage\.resetsIn/i)
      expect(resetTexts.length).toBeGreaterThan(0)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. Cross-Component Upgrade Flow (End-to-End)
// Tests the complete chain: capacity alert → upgrade button → pricing
// ═══════════════════════════════════════════════════════════════════════════
describe('Cross-Component Upgrade Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

  it('should trigger pricing from AppsFull upgrade button', async () => {
    const user = userEvent.setup()
    setupBilling({ billing: { subscription: { plan: 'sandbox' } }, apps: { size: 5, limit: 5 } })

    render(<AppsFull loc="app-create" />)

    const upgradeText = screen.getByText(/upgradeBtn\.encourageShort/i)
    await user.click(upgradeText)

    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
  })

  it('should trigger pricing from VectorSpaceFull upgrade button', async () => {
    const user = userEvent.setup()
    setupBilling({
      billing: { subscription: { plan: 'sandbox' } },
      vectorSpace: { size: 50, limit: 50 },
    })

    render(<VectorSpaceFull />)

    const upgradeText = screen.getByText(/upgradeBtn\.encourage$/i)
    await user.click(upgradeText)

    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
  })

  it('should trigger pricing from AnnotationFull upgrade button', async () => {
    const user = userEvent.setup()
    setupBilling({
      billing: { subscription: { plan: 'sandbox' } },
      annotation_quota_limit: { size: 10, limit: 10 },
    })

    render(<AnnotationFull />)

    const upgradeText = screen.getByText(/upgradeBtn\.encourage$/i)
    await user.click(upgradeText)

    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
  })

  it('should trigger pricing from TriggerEventsLimitModal through PlanUpgradeModal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    setupBilling({ billing: { subscription: { plan: 'professional' } } })

    render(<TriggerEventsLimitModal show={true} onClose={onClose} usage={20000} total={20000} />)

    // PlanUpgradeModal dismisses the quota notice before opening pricing.
    const upgradeBtn = screen.getByText(/triggerLimitModal\.upgrade/i)
    await user.click(upgradeBtn)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should trigger pricing from AnnotationFullModal upgrade button', async () => {
    const user = userEvent.setup()
    setupBilling({
      billing: { subscription: { plan: 'sandbox' } },
      annotation_quota_limit: { size: 10, limit: 10 },
    })

    render(<AnnotationFullModal show={true} onHide={vi.fn()} />)

    const upgradeText = screen.getByText(/upgradeBtn\.encourage$/i)
    await user.click(upgradeText)

    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
  })
})
