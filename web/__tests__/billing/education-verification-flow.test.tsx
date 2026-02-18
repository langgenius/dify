/**
 * Integration test: Education Verification Flow
 *
 * Tests the education plan verification flow in PlanComp:
 *   PlanComp → handleVerify → useEducationVerify → router.push → education-apply
 *   PlanComp → handleVerify → error → show VerifyStateModal
 *
 * Also covers education button visibility based on context flags.
 */
import type { UsagePlanInfo, UsageResetInfo } from '@/app/components/billing/type'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { defaultPlan } from '@/app/components/billing/config'
import PlanComp from '@/app/components/billing/plan'
import { Plan } from '@/app/components/billing/type'

// ─── Mock state ──────────────────────────────────────────────────────────────
let mockProviderCtx: Record<string, unknown> = {}
let mockAppCtx: Record<string, unknown> = {}
const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
const mockRouterPush = vi.fn()
const mockMutateAsync = vi.fn()

// ─── Context mocks ───────────────────────────────────────────────────────────
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
}))

// ─── Service mocks ───────────────────────────────────────────────────────────
vi.mock('@/service/use-education', () => ({
  useEducationVerify: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/service/use-billing', () => ({
  useBillingUrl: () => ({
    data: 'https://billing.example.com',
    isFetching: false,
    refetch: vi.fn(),
  }),
}))

// ─── Navigation mocks ───────────────────────────────────────────────────────
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
  default: ({ isShow, title, content, email, showLink }: {
    isShow: boolean
    title?: string
    content?: string
    email?: string
    showLink?: boolean
  }) =>
    isShow
      ? (
          <div data-testid="verify-state-modal">
            {title && <span data-testid="modal-title">{title}</span>}
            {content && <span data-testid="modal-content">{content}</span>}
            {email && <span data-testid="modal-email">{email}</span>}
            {showLink && <span data-testid="modal-show-link">link</span>}
          </div>
        )
      : null,
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
) => {
  mockProviderCtx = {
    plan: createPlanData(planOverrides),
    enableBilling: true,
    isFetchedPlan: true,
    enableEducationPlan: false,
    isEducationAccount: false,
    allowRefreshEducationVerify: false,
    ...providerOverrides,
  }
  mockAppCtx = {
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
      setupContexts({}, { enableEducationPlan: true, isEducationAccount: false })

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
    })

    it('should not show verify button when already verified and not about to expire', () => {
      setupContexts({}, {
        enableEducationPlan: true,
        isEducationAccount: true,
        allowRefreshEducationVerify: false,
      })

      render(<PlanComp loc="test" />)

      expect(screen.queryByText(/toVerified/i)).not.toBeInTheDocument()
    })

    it('should show verify button when about to expire (allowRefreshEducationVerify is true)', () => {
      setupContexts({}, {
        enableEducationPlan: true,
        isEducationAccount: true,
        allowRefreshEducationVerify: true,
      })

      render(<PlanComp loc="test" />)

      // Shown because isAboutToExpire = allowRefreshEducationVerify = true
      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
    })
  })

  // ─── 2. Successful Verification Flow ────────────────────────────────────
  describe('Successful verification flow', () => {
    it('should navigate to education-apply with token on successful verification', async () => {
      mockMutateAsync.mockResolvedValue({ token: 'edu-token-123' })
      setupContexts({}, { enableEducationPlan: true, isEducationAccount: false })
      const user = userEvent.setup()

      render(<PlanComp loc="test" />)

      const verifyButton = screen.getByText(/toVerified/i)
      await user.click(verifyButton)

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(1)
        expect(mockRouterPush).toHaveBeenCalledWith('/education-apply?token=edu-token-123')
      })
    })

    it('should remove education verifying flag from localStorage on success', async () => {
      mockMutateAsync.mockResolvedValue({ token: 'token-xyz' })
      setupContexts({}, { enableEducationPlan: true, isEducationAccount: false })
      const user = userEvent.setup()

      render(<PlanComp loc="test" />)

      await user.click(screen.getByText(/toVerified/i))

      await waitFor(() => {
        expect(localStorage.removeItem).toHaveBeenCalledWith('educationVerifying')
      })
    })
  })

  // ─── 3. Failed Verification Flow ────────────────────────────────────────
  describe('Failed verification flow', () => {
    it('should show VerifyStateModal with rejection info on error', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Verification failed'))
      setupContexts({}, { enableEducationPlan: true, isEducationAccount: false })
      const user = userEvent.setup()

      render(<PlanComp loc="test" />)

      // Modal should not be visible initially
      expect(screen.queryByTestId('verify-state-modal')).not.toBeInTheDocument()

      const verifyButton = screen.getByText(/toVerified/i)
      await user.click(verifyButton)

      // Modal should appear after verification failure
      await waitFor(() => {
        expect(screen.getByTestId('verify-state-modal')).toBeInTheDocument()
      })

      // Modal should display rejection title and content
      expect(screen.getByTestId('modal-title')).toHaveTextContent(/rejectTitle/i)
      expect(screen.getByTestId('modal-content')).toHaveTextContent(/rejectContent/i)
    })

    it('should show email and link in VerifyStateModal', async () => {
      mockMutateAsync.mockRejectedValue(new Error('fail'))
      setupContexts({}, { enableEducationPlan: true, isEducationAccount: false })
      const user = userEvent.setup()

      render(<PlanComp loc="test" />)

      await user.click(screen.getByText(/toVerified/i))

      await waitFor(() => {
        expect(screen.getByTestId('modal-email')).toHaveTextContent('student@university.edu')
        expect(screen.getByTestId('modal-show-link')).toBeInTheDocument()
      })
    })

    it('should not redirect on verification failure', async () => {
      mockMutateAsync.mockRejectedValue(new Error('fail'))
      setupContexts({}, { enableEducationPlan: true, isEducationAccount: false })
      const user = userEvent.setup()

      render(<PlanComp loc="test" />)

      await user.click(screen.getByText(/toVerified/i))

      await waitFor(() => {
        expect(screen.getByTestId('verify-state-modal')).toBeInTheDocument()
      })

      // Should NOT navigate
      expect(mockRouterPush).not.toHaveBeenCalled()
    })
  })

  // ─── 4. Education + Upgrade Coexistence ─────────────────────────────────
  describe('Education and upgrade button coexistence', () => {
    it('should show both education verify and upgrade buttons for sandbox user', () => {
      setupContexts(
        { type: Plan.sandbox },
        { enableEducationPlan: true, isEducationAccount: false },
      )

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.encourageShort/i)).toBeInTheDocument()
    })

    it('should not show upgrade button for enterprise plan', () => {
      setupContexts(
        { type: Plan.enterprise },
        { enableEducationPlan: true, isEducationAccount: false },
      )

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
      expect(screen.queryByText(/upgradeBtn\.encourageShort/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/upgradeBtn\.plain/i)).not.toBeInTheDocument()
    })

    it('should show team plan with plain upgrade button and education button', () => {
      setupContexts(
        { type: Plan.team },
        { enableEducationPlan: true, isEducationAccount: false },
      )

      render(<PlanComp loc="test" />)

      expect(screen.getByText(/toVerified/i)).toBeInTheDocument()
      expect(screen.getByText(/upgradeBtn\.plain/i)).toBeInTheDocument()
    })
  })
})
