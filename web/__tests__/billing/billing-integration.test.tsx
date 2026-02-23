import type { UsagePlanInfo, UsageResetInfo } from '@/app/components/billing/type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import AnnotationFull from '@/app/components/billing/annotation-full'
import AnnotationFullModal from '@/app/components/billing/annotation-full/modal'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import Billing from '@/app/components/billing/billing-page'
import { defaultPlan, NUM_INFINITE } from '@/app/components/billing/config'
import HeaderBillingBtn from '@/app/components/billing/header-billing-btn'
import PlanComp from '@/app/components/billing/plan'
import PlanUpgradeModal from '@/app/components/billing/plan-upgrade-modal'
import PriorityLabel from '@/app/components/billing/priority-label'
import TriggerEventsLimitModal from '@/app/components/billing/trigger-events-limit-modal'
import { Plan } from '@/app/components/billing/type'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'

let mockProviderCtx: Record<string, unknown> = {}
let mockAppCtx: Record<string, unknown> = {}
const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderCtx,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockAppCtx,
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowPricingModal: mockSetShowPricingModal,
  }),
  useModalContextSelector: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    }),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
  useGetPricingPageLanguage: () => 'en',
}))

// ─── Service mocks ──────────────────────────────────────────────────────────
const mockRefetch = vi.fn().mockResolvedValue({ data: 'https://billing.example.com' })
vi.mock('@/service/use-billing', () => ({
  useBillingUrl: () => ({
    data: 'https://billing.example.com',
    isFetching: false,
    refetch: mockRefetch,
  }),
  useBindPartnerStackInfo: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/service/use-education', () => ({
  useEducationVerify: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ token: 'test-token' }),
    isPending: false,
  }),
}))

// ─── Navigation mocks ───────────────────────────────────────────────────────
const mockRouterPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => vi.fn(),
}))

// ─── External component mocks ───────────────────────────────────────────────
vi.mock('@/app/education-apply/verify-state-modal', () => ({
  default: ({ isShow }: { isShow: boolean }) =>
    isShow ? <div data-testid="verify-state-modal" /> : null,
}))

vi.mock('@/app/components/header/utils/util', () => ({
  mailToSupport: () => 'mailto:support@test.com',
}))

// ─── Test data factories ────────────────────────────────────────────────────
type PlanOverrides = {
  type?: string
  usage?: Partial<UsagePlanInfo>
  total?: Partial<UsagePlanInfo>
  reset?: Partial<UsageResetInfo>
}

const createPlanData = (overrides: PlanOverrides = {}) => ({
  ...defaultPlan,
  ...overrides,
  type: overrides.type ?? defaultPlan.type,
  usage: { ...defaultPlan.usage, ...overrides.usage },
  total: { ...defaultPlan.total, ...overrides.total },
  reset: { ...defaultPlan.reset, ...overrides.reset },
})

const setupProviderContext = (planOverrides: PlanOverrides = {}, extra: Record<string, unknown> = {}) => {
  mockProviderCtx = {
    plan: createPlanData(planOverrides),
    enableBilling: true,
    isFetchedPlan: true,
    enableEducationPlan: false,
    isEducationAccount: false,
    allowRefreshEducationVerify: false,
    ...extra,
  }
}

const setupAppContext = (overrides: Record<string, unknown> = {}) => {
  mockAppCtx = {
    isCurrentWorkspaceManager: true,
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
describe('Billing Page + Plan Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAppContext()
  })

  // Verify that the billing page renders PlanComp with all 7 usage items
  describe('Rendering complete plan information', () => {
    it('should display all 7 usage metrics for sandbox plan', () => {
      setupProviderContext({
        type: Plan.sandbox,
        usage: {
          buildApps: 3,
          teamMembers: 1,
          documentsUploadQuota: 10,
          vectorSpace: 20,
          annotatedResponse: 5,
          triggerEvents: 1000,
          apiRateLimit: 2000,
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

    it('should display usage values as "usage / total" format', () => {
      setupProviderContext({
        type: Plan.sandbox,
        usage: { buildApps: 3, teamMembers: 1 },
        total: { buildApps: 5, teamMembers: 1 },
      })

      render(<PlanComp loc="test" />)

      // Check that the buildApps usage fraction "3 / 5" is rendered
      const usageContainers = screen.getAllByText('3')
      expect(usageContainers.length).toBeGreaterThan(0)
      const totalContainers = screen.getAllByText('5')
      expect(totalContainers.length).toBeGreaterThan(0)
    })

    it('should show "unlimited" for infinite quotas (professional API rate limit)', () => {
      setupProviderContext({
        type: Plan.professional,
        total: { apiRateLimit: NUM_INFINITE },
      })

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/plansCommon\.unlimited/i)).toBeInTheDocument()
    })

    it('should display reset days for trigger events when applicable', () => {
      setupProviderContext({
        type: Plan.professional,
        total: { triggerEvents: 20000 },
        reset: { triggerEvents: 7 },
      })

      render(<PlanComp loc="test" />)

      // Reset text should be visible
      expect(screen.getByText(/usagePage\.resetsIn/i)).toBeInTheDocument()
    })
  })

  // Verify billing URL button visibility and behavior
  describe('Billing URL button', () => {
    it('should show billing button when enableBilling and isCurrentWorkspaceManager', () => {
      setupProviderContext({ type: Plan.sandbox })
      setupAppContext({ isCurrentWorkspaceManager: true })

      render(<Billing />)

      expect(screen.getByText(/viewBillingTitle/i)).toBeInTheDocument()
      expect(screen.getByText(/viewBillingAction/i)).toBeInTheDocument()
    })

    it('should hide billing button when user is not workspace manager', () => {
      setupProviderContext({ type: Plan.sandbox })
      setupAppContext({ isCurrentWorkspaceManager: false })

      render(<Billing />)

      expect(screen.queryByText(/viewBillingTitle/i)).not.toBeInTheDocument()
    })

    it('should hide billing button when billing is disabled', () => {
      setupProviderContext({ type: Plan.sandbox }, { enableBilling: false })

      render(<Billing />)

      expect(screen.queryByText(/viewBillingTitle/i)).not.toBeInTheDocument()
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
    setupAppContext()
  })

  it('should render sandbox plan with upgrade button (premium badge)', () => {
    setupProviderContext({ type: Plan.sandbox })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/plans\.sandbox\.name/i)).toBeInTheDocument()
    expect(screen.getByText(/plans\.sandbox\.for/i)).toBeInTheDocument()
    // Sandbox shows premium badge upgrade button (not plain)
    expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
  })

  it('should render professional plan with plain upgrade button', () => {
    setupProviderContext({ type: Plan.professional })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/plans\.professional\.name/i)).toBeInTheDocument()
    // Professional shows plain button because it's not team
    expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
  })

  it('should render team plan with plain-style upgrade button', () => {
    setupProviderContext({ type: Plan.team })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/plans\.team\.name/i)).toBeInTheDocument()
    // Team plan has isPlain=true, so shows "upgradeBtn.plain" text
    expect(screen.getByText(/upgradeBtn\.plain/i)).toBeInTheDocument()
  })

  it('should not render upgrade button for enterprise plan', () => {
    setupProviderContext({ type: Plan.enterprise })

    render(<PlanComp loc="test" />)

    expect(screen.queryByText(/upgradeBtn\.encourageShort/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/upgradeBtn\.plain/i)).not.toBeInTheDocument()
  })

  it('should show education verify button when enableEducationPlan is true and not yet verified', () => {
    setupProviderContext({ type: Plan.sandbox }, {
      enableEducationPlan: true,
      isEducationAccount: false,
    })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Upgrade Flow Integration
// Tests the flow: UpgradeBtn click → setShowPricingModal
// and PlanUpgradeModal → close + trigger pricing
// ═══════════════════════════════════════════════════════════════════════════
describe('Upgrade Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAppContext()
    setupProviderContext({ type: Plan.sandbox })
  })

  // UpgradeBtn triggers pricing modal
  describe('UpgradeBtn triggers pricing modal', () => {
    it('should call setShowPricingModal when clicking premium badge upgrade button', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn />)

      const badgeText = screen.getByText(/upgradeBtn\.encourage/i)
      await user.click(badgeText)

      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should call setShowPricingModal when clicking plain upgrade button', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn isPlain />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should use custom onClick when provided instead of setShowPricingModal', async () => {
      const customOnClick = vi.fn()
      const user = userEvent.setup()

      render(<UpgradeBtn onClick={customOnClick} />)

      const badgeText = screen.getByText(/upgradeBtn\.encourage/i)
      await user.click(badgeText)

      expect(customOnClick).toHaveBeenCalledTimes(1)
      expect(mockSetShowPricingModal).not.toHaveBeenCalled()
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
    it('should call onClose and setShowPricingModal when clicking upgrade button in modal', async () => {
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
      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should call onClose and custom onUpgrade when provided', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onUpgrade = vi.fn()

      render(
        <PlanUpgradeModal
          show={true}
          onClose={onClose}
          onUpgrade={onUpgrade}
          title="Test"
          description="Test"
        />,
      )

      const upgradeText = screen.getByText(/triggerLimitModal\.upgrade/i)
      await user.click(upgradeText)

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onUpgrade).toHaveBeenCalledTimes(1)
      // Custom onUpgrade replaces default setShowPricingModal
      expect(mockSetShowPricingModal).not.toHaveBeenCalled()
    })

    it('should call onClose when clicking dismiss button', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(
        <PlanUpgradeModal
          show={true}
          onClose={onClose}
          title="Test"
          description="Test"
        />,
      )

      const dismissBtn = screen.getByText(/triggerLimitModal\.dismiss/i)
      await user.click(dismissBtn)

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(mockSetShowPricingModal).not.toHaveBeenCalled()
    })
  })

  // Upgrade from PlanComp: clicking upgrade button in plan component triggers pricing
  describe('PlanComp upgrade button triggers pricing', () => {
    it('should open pricing modal when clicking upgrade in sandbox plan', async () => {
      const user = userEvent.setup()
      setupProviderContext({ type: Plan.sandbox })

      render(<PlanComp loc="test-loc" />)

      const upgradeText = screen.getByText(/upgradeBtn\.encourageShort/i)
      await user.click(upgradeText)

      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
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
    setupAppContext()
  })

  // AppsFull renders with correct messaging and components
  describe('AppsFull integration', () => {
    it('should display upgrade tip and upgrade button for sandbox plan at capacity', () => {
      setupProviderContext({
        type: Plan.sandbox,
        usage: { buildApps: 5 },
        total: { buildApps: 5 },
      })

      render(<AppsFull loc="test" />)

      // Should show "full" tip
      expect(screen.getByText(/apps\.fullTip1$/i)).toBeInTheDocument()
      // Should show upgrade button
      expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
      // Should show usage/total fraction "5/5"
      expect(screen.getByText(/5\/5/)).toBeInTheDocument()
      // Should have a progress bar rendered
      expect(screen.getByTestId('billing-progress-bar')).toBeInTheDocument()
    })

    it('should display upgrade tip and upgrade button for professional plan', () => {
      setupProviderContext({
        type: Plan.professional,
        usage: { buildApps: 48 },
        total: { buildApps: 50 },
      })

      render(<AppsFull loc="test" />)

      expect(screen.getByText(/apps\.fullTip1$/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
    })

    it('should display contact tip and contact button for team plan', () => {
      setupProviderContext({
        type: Plan.team,
        usage: { buildApps: 200 },
        total: { buildApps: 200 },
      })

      render(<AppsFull loc="test" />)

      // Team plan shows different tip
      expect(screen.getByText(/apps\.fullTip2$/i)).toBeInTheDocument()
      // Team plan shows "Contact Us" instead of upgrade
      expect(screen.getByText(/apps\.contactUs/i)).toBeInTheDocument()
      expect(screen.queryByText(/upgradeBtn\.encourageShort/i)).not.toBeInTheDocument()
    })

    it('should render progress bar with correct color based on usage percentage', () => {
      // 100% usage should show error color
      setupProviderContext({
        type: Plan.sandbox,
        usage: { buildApps: 5 },
        total: { buildApps: 5 },
      })

      render(<AppsFull loc="test" />)

      const progressBar = screen.getByTestId('billing-progress-bar')
      expect(progressBar).toHaveClass('bg-components-progress-error-progress')
    })
  })

  // VectorSpaceFull renders with VectorSpaceInfo and UpgradeBtn
  describe('VectorSpaceFull integration', () => {
    it('should display full tip, upgrade button, and vector space usage info', () => {
      setupProviderContext({
        type: Plan.sandbox,
        usage: { vectorSpace: 50 },
        total: { vectorSpace: 50 },
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
      setupProviderContext({
        type: Plan.sandbox,
        usage: { annotatedResponse: 10 },
        total: { annotatedResponse: 10 },
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
      setupProviderContext({
        type: Plan.sandbox,
        usage: { annotatedResponse: 10 },
        total: { annotatedResponse: 10 },
      })

      render(<AnnotationFullModal show={true} onHide={vi.fn()} />)

      expect(screen.getByText(/annotatedResponse\.fullTipLine1/i)).toBeInTheDocument()
      expect(screen.getByText(/annotatedResponse\.quotaTitle/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourage$/i)).toBeInTheDocument()
    })

    it('should not render content when show is false', () => {
      setupProviderContext({
        type: Plan.sandbox,
        usage: { annotatedResponse: 10 },
        total: { annotatedResponse: 10 },
      })

      render(<AnnotationFullModal show={false} onHide={vi.fn()} />)

      expect(screen.queryByText(/annotatedResponse\.fullTipLine1/i)).not.toBeInTheDocument()
    })
  })

  // TriggerEventsLimitModal renders PlanUpgradeModal with embedded UsageInfo
  describe('TriggerEventsLimitModal integration', () => {
    it('should display trigger limit title, usage info, and upgrade button', () => {
      setupProviderContext({ type: Plan.professional })

      render(
        <TriggerEventsLimitModal
          show={true}
          onClose={vi.fn()}
          onUpgrade={vi.fn()}
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

    it('should call onClose and onUpgrade when clicking upgrade', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onUpgrade = vi.fn()
      setupProviderContext({ type: Plan.professional })

      render(
        <TriggerEventsLimitModal
          show={true}
          onClose={onClose}
          onUpgrade={onUpgrade}
          usage={20000}
          total={20000}
        />,
      )

      const upgradeBtn = screen.getByText(/triggerLimitModal\.upgrade/i)
      await user.click(upgradeBtn)

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onUpgrade).toHaveBeenCalledTimes(1)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. Header Billing Button Integration
// Tests HeaderBillingBtn behavior for different plan states
// ═══════════════════════════════════════════════════════════════════════════
describe('Header Billing Button Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAppContext()
  })

  it('should render UpgradeBtn (premium badge) for sandbox plan', () => {
    setupProviderContext({ type: Plan.sandbox })

    render(<HeaderBillingBtn />)

    expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
  })

  it('should render "pro" badge for professional plan', () => {
    setupProviderContext({ type: Plan.professional })

    render(<HeaderBillingBtn />)

    expect(screen.getByText('pro')).toBeInTheDocument()
    expect(screen.queryByText(/upgradeBtn/i)).not.toBeInTheDocument()
  })

  it('should render "team" badge for team plan', () => {
    setupProviderContext({ type: Plan.team })

    render(<HeaderBillingBtn />)

    expect(screen.getByText('team')).toBeInTheDocument()
  })

  it('should return null when billing is disabled', () => {
    setupProviderContext({ type: Plan.sandbox }, { enableBilling: false })

    const { container } = render(<HeaderBillingBtn />)

    expect(container.innerHTML).toBe('')
  })

  it('should return null when plan is not fetched yet', () => {
    setupProviderContext({ type: Plan.sandbox }, { isFetchedPlan: false })

    const { container } = render(<HeaderBillingBtn />)

    expect(container.innerHTML).toBe('')
  })

  it('should call onClick when clicking pro/team badge in non-display-only mode', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    setupProviderContext({ type: Plan.professional })

    render(<HeaderBillingBtn onClick={onClick} />)

    await user.click(screen.getByText('pro'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should not call onClick when isDisplayOnly is true', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    setupProviderContext({ type: Plan.professional })

    render(<HeaderBillingBtn onClick={onClick} isDisplayOnly />)

    await user.click(screen.getByText('pro'))

    expect(onClick).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. PriorityLabel Integration
// Tests priority badge display for different plan types
// ═══════════════════════════════════════════════════════════════════════════
describe('PriorityLabel Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAppContext()
  })

  it('should display "standard" priority for sandbox plan', () => {
    setupProviderContext({ type: Plan.sandbox })

    render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.standard/i)).toBeInTheDocument()
  })

  it('should display "priority" for professional plan with icon', () => {
    setupProviderContext({ type: Plan.professional })

    const { container } = render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.priority/i)).toBeInTheDocument()
    // Professional plan should show the priority icon
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should display "top-priority" for team plan with icon', () => {
    setupProviderContext({ type: Plan.team })

    const { container } = render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.top-priority/i)).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should display "top-priority" for enterprise plan', () => {
    setupProviderContext({ type: Plan.enterprise })

    render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.top-priority/i)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. Usage Display Edge Cases
// Tests storage mode, threshold logic, and progress bar color integration
// ═══════════════════════════════════════════════════════════════════════════
describe('Usage Display Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAppContext()
  })

  // Vector space storage mode behavior
  describe('VectorSpace storage mode in PlanComp', () => {
    it('should show "< 50" for sandbox plan with low vector space usage', () => {
      setupProviderContext({
        type: Plan.sandbox,
        usage: { vectorSpace: 10 },
        total: { vectorSpace: 50 },
      })

      render(<PlanComp loc="test" />)

      // Storage mode: usage below threshold shows "< 50"
      expect(screen.getByText(/</)).toBeInTheDocument()
    })

    it('should show indeterminate progress bar for usage below threshold', () => {
      setupProviderContext({
        type: Plan.sandbox,
        usage: { vectorSpace: 10 },
        total: { vectorSpace: 50 },
      })

      render(<PlanComp loc="test" />)

      // Should have an indeterminate progress bar
      expect(screen.getByTestId('billing-progress-bar-indeterminate')).toBeInTheDocument()
    })

    it('should show actual usage for pro plan above threshold', () => {
      setupProviderContext({
        type: Plan.professional,
        usage: { vectorSpace: 1024 },
        total: { vectorSpace: 5120 },
      })

      render(<PlanComp loc="test" />)

      // Pro plan above threshold shows actual value
      expect(screen.getByText('1024')).toBeInTheDocument()
    })
  })

  // Progress bar color logic through real components
  describe('Progress bar color reflects usage severity', () => {
    it('should show normal color for low usage percentage', () => {
      setupProviderContext({
        type: Plan.sandbox,
        usage: { buildApps: 1 },
        total: { buildApps: 5 },
      })

      render(<PlanComp loc="test" />)

      // 20% usage - normal color
      const progressBars = screen.getAllByTestId('billing-progress-bar')
      // At least one should have the normal progress color
      const hasNormalColor = progressBars.some(bar =>
        bar.classList.contains('bg-components-progress-bar-progress-solid'),
      )
      expect(hasNormalColor).toBe(true)
    })
  })

  // Reset days calculation in PlanComp
  describe('Reset days integration', () => {
    it('should not show reset for sandbox trigger events (no reset_date)', () => {
      setupProviderContext({
        type: Plan.sandbox,
        total: { triggerEvents: 3000 },
        reset: { triggerEvents: null },
      })

      render(<PlanComp loc="test" />)

      // Find the trigger events section - should not have reset text
      const triggerSection = screen.getByText(/usagePage\.triggerEvents/i)
      const parent = triggerSection.closest('[class*="flex flex-col"]')
      // No reset text should appear (sandbox doesn't show reset for triggerEvents)
      expect(parent?.textContent).not.toContain('usagePage.resetsIn')
    })

    it('should show reset for professional trigger events with reset date', () => {
      setupProviderContext({
        type: Plan.professional,
        total: { triggerEvents: 20000 },
        reset: { triggerEvents: 14 },
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
    setupAppContext()
  })

  it('should trigger pricing from AppsFull upgrade button', async () => {
    const user = userEvent.setup()
    setupProviderContext({
      type: Plan.sandbox,
      usage: { buildApps: 5 },
      total: { buildApps: 5 },
    })

    render(<AppsFull loc="app-create" />)

    const upgradeText = screen.getByText(/upgradeBtn\.encourageShort/i)
    await user.click(upgradeText)

    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
  })

  it('should trigger pricing from VectorSpaceFull upgrade button', async () => {
    const user = userEvent.setup()
    setupProviderContext({
      type: Plan.sandbox,
      usage: { vectorSpace: 50 },
      total: { vectorSpace: 50 },
    })

    render(<VectorSpaceFull />)

    const upgradeText = screen.getByText(/upgradeBtn\.encourage$/i)
    await user.click(upgradeText)

    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
  })

  it('should trigger pricing from AnnotationFull upgrade button', async () => {
    const user = userEvent.setup()
    setupProviderContext({
      type: Plan.sandbox,
      usage: { annotatedResponse: 10 },
      total: { annotatedResponse: 10 },
    })

    render(<AnnotationFull />)

    const upgradeText = screen.getByText(/upgradeBtn\.encourage$/i)
    await user.click(upgradeText)

    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
  })

  it('should trigger pricing from TriggerEventsLimitModal through PlanUpgradeModal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    setupProviderContext({ type: Plan.professional })

    render(
      <TriggerEventsLimitModal
        show={true}
        onClose={onClose}
        onUpgrade={vi.fn()}
        usage={20000}
        total={20000}
      />,
    )

    // TriggerEventsLimitModal passes onUpgrade to PlanUpgradeModal
    // PlanUpgradeModal's upgrade button calls onClose then onUpgrade
    const upgradeBtn = screen.getByText(/triggerLimitModal\.upgrade/i)
    await user.click(upgradeBtn)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should trigger pricing from AnnotationFullModal upgrade button', async () => {
    const user = userEvent.setup()
    setupProviderContext({
      type: Plan.sandbox,
      usage: { annotatedResponse: 10 },
      total: { annotatedResponse: 10 },
    })

    render(<AnnotationFullModal show={true} onHide={vi.fn()} />)

    const upgradeText = screen.getByText(/upgradeBtn\.encourage$/i)
    await user.click(upgradeText)

    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
  })
})
