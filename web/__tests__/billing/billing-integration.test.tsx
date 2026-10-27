import type {
  GetFeaturesResponse,
  GetFeaturesVectorSpaceResponse,
} from '@dify/contracts/api/console/features/types.gen'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { DeepPartial } from '@/test/console/system-features'
import { render as renderUI, screen, waitFor, within } from '@testing-library/react'
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

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

let mockFeatures: DeepPartial<GetFeaturesResponse> = {}
let mockVectorSpace: GetFeaturesVectorSpaceResponse = { size: 0, limit: 50, usage_unknown: false }
let workspaceRole: 'owner' | 'normal' = 'owner'
let workspacePermissionKeys: string[] = []
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
    accountProfile: { email: 'test@example.com' },
    currentWorkspace: { role: workspaceRole },
    workspacePermissionKeys,
    accountProfileMeta: { currentVersion: '1.0.0' },
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: mockFeatures,
    queryClient,
  })
  return renderUI(ui, { ...options, wrapper })
}

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

const mockRouterPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}))

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

const setupConsoleState = (
  overrides: { role?: 'owner' | 'normal'; workspacePermissionKeys?: string[] } = {},
) => {
  workspaceRole = overrides.role ?? 'owner'
  workspacePermissionKeys = overrides.workspacePermissionKeys ?? []
}

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('Billing Page + Plan Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

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

      expect(screen.getByText(/plans\.sandbox\.name/i)).toBeInTheDocument()

      for (const [name, value] of [
        ['usagePage.buildApps', /3\s*\/\s*5/],
        ['usagePage.teamMembers', /1\s*\/\s*1/],
        ['usagePage.documentsUploadQuota', /10\s*\/\s*50/],
        ['usagePage.vectorSpace', /< 50\s*MB/],
        ['usagePage.annotationQuota', /5\s*\/\s*10/],
        ['usagePage.triggerEvents', /1000\s*\/\s*3000/],
        ['plansCommon.apiRateLimit', /2000\s*\/\s*5000/],
      ] as const) {
        const card = screen.getByRole('group', { name: `billing.${name}` })
        expect(within(card).getByRole('definition').textContent).toMatch(value)
      }
    })

    it('should display unknown vector space usage as a placeholder', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        vectorSpace: { size: 0, limit: 50 },
      })

      render(<PlanComp loc="test" />, {}, true)

      const quotaCard = screen.getByRole('group', { name: /usagePage\.vectorSpace/i })
      const quotaValue = within(quotaCard).getByRole('definition')
      expect(quotaValue).toHaveTextContent('--')
      expect(quotaValue).not.toHaveTextContent('< 50')
    })

    it('should show "unlimited" for infinite quotas (professional API rate limit)', () => {
      setupBilling({
        billing: { subscription: { plan: 'professional' } },
        api_rate_limit: { limit: NUM_INFINITE },
      })

      render(<PlanComp loc="test" />)

      expect(
        within(screen.getByRole('group', { name: /plansCommon\.apiRateLimit/i })).getByRole(
          'definition',
        ),
      ).toHaveTextContent('billing.plansCommon.unlimited')
    })
  })

  describe('Billing URL button', () => {
    it('should show billing button to managers without billing permission keys', () => {
      setupBilling({ billing: { subscription: { plan: 'sandbox' } } })
      setupConsoleState({
        role: 'owner',
        workspacePermissionKeys: [],
      })

      render(<Billing />)

      expect(screen.getByRole('link', { name: /viewBillingTitle/i })).toHaveAttribute(
        'href',
        'https://billing.example.com',
      )
    })

    it('should hide billing button from non-manager members', () => {
      setupBilling({ billing: { subscription: { plan: 'sandbox' } } })
      setupConsoleState({
        role: 'normal',
      })

      render(<Billing />)

      expect(screen.queryByText(/viewBillingTitle/i)).not.toBeInTheDocument()
    })
  })
})

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
    expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
  })

  it('should render professional plan with plain upgrade button', () => {
    setupBilling({ billing: { subscription: { plan: 'professional' } } })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/plans\.professional\.name/i)).toBeInTheDocument()
    expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
  })

  it('should render team plan with plain-style upgrade button', () => {
    setupBilling({ billing: { subscription: { plan: 'team' } } })

    render(<PlanComp loc="test" />)

    expect(screen.getByText(/plans\.team\.name/i)).toBeInTheDocument()
    expect(screen.getByText(/upgradeBtn\.plain/i)).toBeInTheDocument()
  })

  it('should show education verify button when enableEducationPlan is true and not yet verified', () => {
    setupBilling({ billing: { subscription: { plan: 'sandbox' } } }, { enableEducationPlan: true })

    render(<PlanComp loc="test" />)

    expect(screen.getByRole('link', { name: /toVerified/i })).toHaveAttribute(
      'href',
      '/education/verify',
    )
  })

  it('should show education discount to managers without billing permission keys', () => {
    setupBilling(
      { billing: { subscription: { plan: 'sandbox' } } },
      { enableEducationPlan: true },
      { is_student: true },
    )
    setupConsoleState({ role: 'owner', workspacePermissionKeys: [] })

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
      role: 'normal',
      workspacePermissionKeys: ['billing.manage'],
    })

    render(<PlanComp loc="test" />)

    expect(screen.queryByText(/useEducationDiscount/i)).not.toBeInTheDocument()
  })
})

describe('Upgrade Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
    setupBilling({ billing: { subscription: { plan: 'sandbox' } } })
  })

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

      expect(screen.getByText('Upgrade Required')).toBeInTheDocument()
      expect(screen.getByText('You need a better plan')).toBeInTheDocument()

      const upgradeText = screen.getByText(/triggerLimitModal\.upgrade/i)
      await user.click(upgradeText)

      expect(onClose).toHaveBeenCalledTimes(1)
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

describe('Capacity Full Components Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

  describe('AppsFull integration', () => {
    it('should display upgrade tip and upgrade button for sandbox plan at capacity', () => {
      setupBilling({ billing: { subscription: { plan: 'sandbox' } }, apps: { size: 5, limit: 5 } })

      render(<AppsFull loc="test" />)

      expect(screen.getByText(/apps\.fullTip1$/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
      expect(screen.getByText(/5\/5/)).toBeInTheDocument()
      expect(screen.getByRole('meter', { name: /usagePage\.buildApps/i })).toBeInTheDocument()
    })

    it('should display contact tip and contact button for team plan', () => {
      setupBilling({ billing: { subscription: { plan: 'team' } }, apps: { size: 200, limit: 200 } })

      render(<AppsFull loc="test" />)

      expect(screen.getByText(/apps\.fullTip2$/i)).toBeInTheDocument()
      expect(screen.getByText(/apps\.contactUs/i)).toBeInTheDocument()
      expect(screen.queryByText(/upgradeBtn\.encourageShort/i)).not.toBeInTheDocument()
    })
  })

  describe('VectorSpaceFull integration', () => {
    it('should display full tip, upgrade button, and vector space usage info', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        vectorSpace: { size: 50, limit: 50 },
      })

      render(<VectorSpaceFull />)

      expect(screen.getByText(/vectorSpace\.fullTip/i)).toBeInTheDocument()
      expect(screen.getByText(/vectorSpace\.fullSolution/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourage$/i)).toBeInTheDocument()
      expect(screen.getByText(/usagePage\.vectorSpace/i)).toBeInTheDocument()
    })
  })

  describe('AnnotationFull integration', () => {
    it('should display annotation full tip, upgrade button, and usage info', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        annotation_quota_limit: { size: 10, limit: 10 },
      })

      render(<AnnotationFull />)

      expect(screen.getByText(/annotatedResponse\.fullTipLine1/i)).toBeInTheDocument()
      expect(screen.getByText(/annotatedResponse\.fullTipLine2/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourage$/i)).toBeInTheDocument()
      expect(screen.getByText(/annotatedResponse\.quotaTitle/i)).toBeInTheDocument()
    })
  })

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

      expect(screen.getByText(/triggerLimitModal\.title/i)).toBeInTheDocument()
      expect(screen.getByText(/triggerLimitModal\.description/i)).toBeInTheDocument()
      expect(screen.getByText(/triggerLimitModal\.usageTitle/i)).toBeInTheDocument()
      expect(screen.getByText('18000')).toBeInTheDocument()
      expect(screen.getByText('20000')).toBeInTheDocument()
      expect(screen.getByText(/usagePage\.resetsIn/i)).toBeInTheDocument()
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

describe('PriorityLabel Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

  it('opens the standard priority explanation without changing the badge', async () => {
    const user = userEvent.setup()
    setupBilling({ billing: { subscription: { plan: 'sandbox' } } })

    render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.standard/i)).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /plansCommon\.documentProcessingPriority$/i }),
    )
    expect((await screen.findByRole('dialog')).textContent).toMatch(
      /plansCommon\.documentProcessingPriorityTip/i,
    )
  })

  it('should display professional processing priority', () => {
    setupBilling({ billing: { subscription: { plan: 'professional' } } })

    render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.priority/i)).toBeInTheDocument()
  })

  it('should display team processing priority', () => {
    setupBilling({ billing: { subscription: { plan: 'team' } } })

    render(<PriorityLabel />)

    expect(screen.getByText(/plansCommon\.priority\.top-priority/i)).toBeInTheDocument()
  })
})

describe('Usage Display Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupConsoleState()
  })

  describe('VectorSpace storage mode in PlanComp', () => {
    it('should show "< 50" for sandbox plan with low vector space usage', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        vectorSpace: { size: 10, limit: 50 },
      })

      render(<PlanComp loc="test" />)

      const storage = screen.getByRole('group', { name: /usagePage\.vectorSpace/i })
      expect(within(storage).getByRole('definition')).toHaveTextContent('< 50')
      expect(within(storage).queryByRole('meter')).not.toBeInTheDocument()
    })

    it('should show actual usage for pro plan above threshold', () => {
      setupBilling({
        billing: { subscription: { plan: 'professional' } },
        vectorSpace: { size: 1024, limit: 5120 },
      })

      render(<PlanComp loc="test" />)

      const storage = screen.getByRole('group', { name: /usagePage\.vectorSpace/i })
      expect(within(storage).getByRole('definition').textContent).toMatch(/1024\s*\/\s*5120MB/)
      expect(within(storage).getByRole('meter')).toHaveAttribute('aria-valuenow', '20')
    })
  })

  describe('Reset days integration', () => {
    it('should not show reset for sandbox trigger events (no reset_date)', () => {
      setupBilling({
        billing: { subscription: { plan: 'sandbox' } },
        trigger_event: { limit: 3000, reset_date: 0 },
      })

      render(<PlanComp loc="test" />)

      const triggerSection = screen.getByRole('group', { name: /usagePage\.triggerEvents/i })
      expect(within(triggerSection).queryByText(/usagePage\.resetsIn/i)).not.toBeInTheDocument()
    })

    it('should show reset for professional trigger events with reset date', () => {
      setupBilling({
        billing: { subscription: { plan: 'professional' } },
        trigger_event: { limit: 20000, reset_date: dayjs().add(14, 'day').startOf('day').unix() },
      })

      render(<PlanComp loc="test" />)

      const triggerSection = screen.getByRole('group', { name: /usagePage\.triggerEvents/i })
      expect(within(triggerSection).getByText(/usagePage\.resetsIn/i)).toBeInTheDocument()
    })
  })
})

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
