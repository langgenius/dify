import type {
  GetFeaturesResponse,
  GetFeaturesVectorSpaceResponse,
} from '@dify/contracts/api/console/features/types.gen'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { DeepPartial } from '@/test/console/system-features'
import { cleanup, screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import * as React from 'react'
import PlanComp from '@/app/components/billing/plan'
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

const renderWithoutPricing = (ui: ReactElement, options: RenderOptions = {}) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryOptions().queryKey, {
    ...mockVectorSpace,
    usage_unknown: false,
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

// ─── Mock state ──────────────────────────────────────────────────────────────

// ─── Context mocks ───────────────────────────────────────────────────────────

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})

// ─── Navigation mocks ───────────────────────────────────────────────────────
vi.mock('@/next/navigation', () => ({
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}))

// ─── Test data factories ────────────────────────────────────────────────────
type BillingOverrides = DeepPartial<GetFeaturesResponse> & {
  vectorSpace?: Partial<GetFeaturesVectorSpaceResponse>
}

const setupBilling = (
  { vectorSpace, ...features }: BillingOverrides = {},
  education: { enableEducationPlan?: boolean } = {},
  appOverrides: Record<string, unknown> = {},
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
  mockConsoleState = {
    isCurrentWorkspaceManager: true,
    userProfile: { email: 'student@university.edu' },
    langGeniusVersionInfo: { current_version: '1.0.0' },
    ...appOverrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('Education Verification Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    setupBilling()
  })

  // ─── 1. Education Button Visibility ─────────────────────────────────────
  describe('Education button visibility', () => {
    it('should not show verify button when enableEducationPlan is false', () => {
      setupBilling({}, { enableEducationPlan: false })

      render(<PlanComp loc="test" />)

      expect(screen.queryByText(/toVerified/i)).not.toBeInTheDocument()
    })

    it('should show verify button when enableEducationPlan is true and not yet verified', () => {
      setupBilling({}, { enableEducationPlan: true })

      render(<PlanComp loc="test" />)

      expect(screen.getByRole('link', { name: /toVerified/i })).toHaveAttribute(
        'href',
        '/education/verify',
      )
    })

    it('should not show verify button when already verified and not about to expire', () => {
      setupBilling({}, { enableEducationPlan: true }, {}, { is_student: true })

      render(<PlanComp loc="test" />)

      expect(screen.queryByText(/toVerified/i)).not.toBeInTheDocument()
    })

    it('should show verify button when the education status allows refresh', () => {
      setupBilling({}, { enableEducationPlan: true }, {}, { is_student: true, allow_refresh: true })

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
    })
  })

  // ─── 2. Education + Upgrade Coexistence ─────────────────────────────────
  describe('Education and upgrade button coexistence', () => {
    it('should show both education verify and upgrade buttons for sandbox user', () => {
      setupBilling(
        { billing: { subscription: { plan: 'sandbox' } } },
        { enableEducationPlan: true },
      )

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
    })

    it('should show team plan with plain upgrade button and education button', () => {
      setupBilling({ billing: { subscription: { plan: 'team' } } }, { enableEducationPlan: true })

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.plain/i)).toBeInTheDocument()
    })
  })
})
