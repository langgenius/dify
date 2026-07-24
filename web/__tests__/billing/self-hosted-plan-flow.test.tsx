/**
 * Integration test: Self-Hosted Plan Flow
 *
 * Tests the self-hosted plan items:
 *   SelfHostedPlanItem → Button click → permission check → redirect to external URL
 *
 * Covers community/premium/enterprise plan rendering, external URL navigation,
 * and workspace manager permission enforcement.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { contactSalesUrl, getStartedWithCommunityUrl, getWithPremiumUrl } from '@/app/components/billing/config'
import SelfHostedPlanItem from '@/app/components/billing/pricing/plans/self-hosted-plan-item'
import { SelfHostedPlan } from '@/app/components/billing/type'

let mockAppCtx: Record<string, unknown> = {}
const mockToastNotify = vi.fn()

const originalLocation = window.location
let assignedHref = ''

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockAppCtx,
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
  useTheme: () => ({ theme: 'light' }),
}))

vi.mock('@/app/components/base/icons/src/public/billing', () => ({
  Azure: () => <span data-testid="icon-azure" />,
  GoogleCloud: () => <span data-testid="icon-gcloud" />,
  AwsMarketplaceLight: () => <span data-testid="icon-aws-light" />,
  AwsMarketplaceDark: () => <span data-testid="icon-aws-dark" />,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: (args: unknown) => mockToastNotify(args) },
}))

vi.mock('@/app/components/billing/pricing/plans/self-hosted-plan-item/list', () => ({
  default: ({ plan }: { plan: string }) => (
    <div data-testid={`self-hosted-list-${plan}`}>Features</div>
  ),
}))

const setupAppContext = (overrides: Record<string, unknown> = {}) => {
  mockAppCtx = {
    isCurrentWorkspaceManager: true,
    ...overrides,
  }
}

describe('Self-Hosted Plan Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    setupAppContext()

    // Mock window.location with minimal getter/setter (Location props are non-enumerable)
    assignedHref = ''
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() { return assignedHref },
        set href(value: string) { assignedHref = value },
      },
    })
  })

  afterEach(() => {
    // Restore original location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  // ─── 1. Plan Rendering ──────────────────────────────────────────────────
  describe('Plan rendering', () => {
    it('should render community plan with name and description', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)

      expect(screen.getByText(/plans\.community\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.community\.description/i)).toBeInTheDocument()
    })

    it('should render premium plan with cloud provider icons', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      expect(screen.getByText(/plans\.premium\.name/i)).toBeInTheDocument()
      expect(screen.getByTestId('icon-azure')).toBeInTheDocument()
      expect(screen.getByTestId('icon-gcloud')).toBeInTheDocument()
    })

    it('should render enterprise plan without cloud provider icons', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.enterprise} />)

      expect(screen.getByText(/plans\.enterprise\.name/i)).toBeInTheDocument()
      expect(screen.queryByTestId('icon-azure')).not.toBeInTheDocument()
    })

    it('should not show price tip for community (free) plan', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)

      expect(screen.queryByText(/plans\.community\.priceTip/i)).not.toBeInTheDocument()
    })

    it('should show price tip for premium plan', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      expect(screen.getByText(/plans\.premium\.priceTip/i)).toBeInTheDocument()
    })

    it('should render features list for each plan', () => {
      const { unmount: unmount1 } = render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)
      expect(screen.getByTestId('self-hosted-list-community')).toBeInTheDocument()
      unmount1()

      const { unmount: unmount2 } = render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)
      expect(screen.getByTestId('self-hosted-list-premium')).toBeInTheDocument()
      unmount2()

      render(<SelfHostedPlanItem plan={SelfHostedPlan.enterprise} />)
      expect(screen.getByTestId('self-hosted-list-enterprise')).toBeInTheDocument()
    })

    it('should show AWS marketplace icon for premium plan button', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      expect(screen.getByTestId('icon-aws-light')).toBeInTheDocument()
    })
  })

  // ─── 2. Navigation Flow ─────────────────────────────────────────────────
  describe('Navigation flow', () => {
    it('should redirect to GitHub when clicking community plan button', async () => {
      const user = userEvent.setup()
      render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(assignedHref).toBe(getStartedWithCommunityUrl)
    })

    it('should redirect to AWS Marketplace when clicking premium plan button', async () => {
      const user = userEvent.setup()
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(assignedHref).toBe(getWithPremiumUrl)
    })

    it('should redirect to Typeform when clicking enterprise plan button', async () => {
      const user = userEvent.setup()
      render(<SelfHostedPlanItem plan={SelfHostedPlan.enterprise} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(assignedHref).toBe(contactSalesUrl)
    })
  })

  // ─── 3. Permission Check ────────────────────────────────────────────────
  describe('Permission check', () => {
    it('should show error toast when non-manager clicks community button', async () => {
      setupAppContext({ isCurrentWorkspaceManager: false })
      const user = userEvent.setup()
      render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)

      const button = screen.getByRole('button')
      await user.click(button)

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        )
      })
      // Should NOT redirect
      expect(assignedHref).toBe('')
    })

    it('should show error toast when non-manager clicks premium button', async () => {
      setupAppContext({ isCurrentWorkspaceManager: false })
      const user = userEvent.setup()
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      const button = screen.getByRole('button')
      await user.click(button)

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        )
      })
      expect(assignedHref).toBe('')
    })

    it('should show error toast when non-manager clicks enterprise button', async () => {
      setupAppContext({ isCurrentWorkspaceManager: false })
      const user = userEvent.setup()
      render(<SelfHostedPlanItem plan={SelfHostedPlan.enterprise} />)

      const button = screen.getByRole('button')
      await user.click(button)

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        )
      })
      expect(assignedHref).toBe('')
    })
  })
})
