import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { UsagePlanInfo, UsageResetInfo } from '@/app/components/billing/type'
import { cleanup, screen } from '@testing-library/react'
import * as React from 'react'
import { defaultPlan } from '@/app/components/billing/config'
import PlanComp from '@/app/components/billing/plan'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedEducationStatus,
} from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'

let mockProviderCtx: Record<string, unknown> = {}
let mockConsoleState: Record<string, unknown> = {}
let mockEducationStatus = { is_student: false, allow_refresh: false, expire_at: null }

const render = (ui: ReactElement, options: RenderOptions = {}) => {
  const queryClient = createConsoleQueryClient()
  const plan = mockProviderCtx.plan as {
    usage: { vectorSpace: number }
    total: { vectorSpace: number }
  }
  queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryOptions().queryKey, {
    size: plan.usage.vectorSpace,
    limit: plan.total.vectorSpace,
    usage_unknown: false,
  })
  seedEducationStatus(queryClient, mockEducationStatus)
  const { wrapper } = createConsoleQueryWrapper({
    accountProfile: mockConsoleState.userProfile as { email?: string },
    accountProfileMeta: { currentVersion: '1.0.0' },
    systemFeatures: { deployment_edition: 'CLOUD' },
    queryClient,
  })
  return renderWithConsoleState(ui, { ...options, wrapper })
}

// ─── Mock state ──────────────────────────────────────────────────────────────
const mockSetShowPricingModal = vi.fn()

// ─── Context mocks ───────────────────────────────────────────────────────────
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderCtx,
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowPricingModal: mockSetShowPricingModal,
  }),
}))

// ─── Navigation mocks ───────────────────────────────────────────────────────
vi.mock('@/next/navigation', () => ({
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
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

const setupContexts = (
  planOverrides: PlanOverrides = {},
  providerOverrides: Record<string, unknown> = {},
  appOverrides: Record<string, unknown> = {},
  educationStatus: Partial<typeof mockEducationStatus> = {},
) => {
  mockEducationStatus = {
    is_student: false,
    allow_refresh: false,
    expire_at: null,
    ...educationStatus,
  }
  mockProviderCtx = {
    plan: createPlanData(planOverrides),
    enableBilling: true,
    isFetchedPlan: true,
    enableEducationPlan: false,
    ...providerOverrides,
  }
  mockConsoleState = {
    isCurrentWorkspaceManager: true,
    userProfile: { email: 'student@university.edu' },
    langGeniusVersionInfo: { current_version: '1.0.0' },
    ...appOverrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('Education Verification Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    setupContexts()
  })

  // ─── 1. Education Button Visibility ─────────────────────────────────────
  describe('Education button visibility', () => {
    it('should not show verify button when enableEducationPlan is false', () => {
      setupContexts({}, { enableEducationPlan: false })

      render(<PlanComp loc="test" />)

      expect(screen.queryByText(/toVerified/i)).not.toBeInTheDocument()
    })

    it('should show verify button when enableEducationPlan is true and not yet verified', () => {
      setupContexts({}, { enableEducationPlan: true })

      render(<PlanComp loc="test" />)

      expect(screen.getByRole('link', { name: /toVerified/i })).toHaveAttribute(
        'href',
        '/education/verify',
      )
    })

    it('should not show verify button when already verified and not about to expire', () => {
      setupContexts({}, { enableEducationPlan: true }, {}, { is_student: true })

      render(<PlanComp loc="test" />)

      expect(screen.queryByText(/toVerified/i)).not.toBeInTheDocument()
    })

    it('should show verify button when the education status allows refresh', () => {
      setupContexts(
        {},
        { enableEducationPlan: true },
        {},
        { is_student: true, allow_refresh: true },
      )

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
    })
  })

  // ─── 2. Education + Upgrade Coexistence ─────────────────────────────────
  describe('Education and upgrade button coexistence', () => {
    it('should show both education verify and upgrade buttons for sandbox user', () => {
      setupContexts({ type: 'sandbox' }, { enableEducationPlan: true })

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
    })

    it('should show team plan with plain upgrade button and education button', () => {
      setupContexts({ type: 'team' }, { enableEducationPlan: true })

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.plain/i)).toBeInTheDocument()
    })
  })
})
