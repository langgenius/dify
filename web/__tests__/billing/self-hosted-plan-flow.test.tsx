import type { SelfHostedPlan } from '@/app/components/billing/config'
/**
 * Integration test: Self-Hosted Plan Flow
 *
 * Tests the self-hosted plan items:
 *   SelfHostedPlanItem → Button click → redirect to external URL
 *
 * Covers community/premium/enterprise plan rendering and external URL navigation.
 */
import { cleanup, screen } from '@testing-library/react'
import * as React from 'react'
import { SELF_HOSTED_PLAN_URLS } from '@/app/components/billing/config'
import { SelfHostedPlanItem } from '@/app/components/billing/pricing/plans/self-hosted-plan-item'
import { render } from '@/test/console/render'

vi.mock('@/app/components/billing/pricing/plans/self-hosted-plan-item/list', () => ({
  SelfHostedPlanFeatures: () => null,
}))

const renderSelfHostedPlanItem = (plan: SelfHostedPlan) => {
  return render(<SelfHostedPlanItem plan={plan} />)
}

describe('Self-Hosted Plan Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  // ─── 1. Plan Rendering ──────────────────────────────────────────────────
  describe('Plan rendering', () => {
    it('should render community plan with name and description', () => {
      renderSelfHostedPlanItem('community')

      expect(screen.getByText(/plans\.community\.name/i)).toBeInTheDocument()
      expect(screen.getByText(/plans\.community\.description/i)).toBeInTheDocument()
    })

    it('should not show price tip for community (free) plan', () => {
      renderSelfHostedPlanItem('community')

      expect(screen.queryByText(/plans\.community\.priceTip/i)).not.toBeInTheDocument()
    })

    it('should show price tip for premium plan', () => {
      renderSelfHostedPlanItem('premium')

      expect(screen.getByText(/plans\.premium\.priceTip/i)).toBeInTheDocument()
    })
  })

  // ─── 2. Navigation Flow ─────────────────────────────────────────────────
  describe('Navigation flow', () => {
    it.each([
      ['community', SELF_HOSTED_PLAN_URLS.community],
      ['premium', SELF_HOSTED_PLAN_URLS.premium],
      ['enterprise', SELF_HOSTED_PLAN_URLS.enterprise],
    ] as const)('should expose the %s destination as a native link', (plan, href) => {
      renderSelfHostedPlanItem(plan)

      expect(screen.getByRole('link')).toHaveAttribute('href', href)
    })
  })
})
