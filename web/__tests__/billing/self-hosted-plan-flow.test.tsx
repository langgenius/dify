import { screen } from '@testing-library/react'
import { SELF_HOSTED_PLAN_URLS } from '@/app/components/billing/config'
import { SelfHostedPlanItem } from '@/app/components/billing/pricing/plans/self-hosted-plan-item'
import { render } from '@/test/console/render'

vi.mock('@/app/components/billing/pricing/plans/self-hosted-plan-item/list', () => ({
  SelfHostedPlanFeatures: () => null,
}))

describe('Self-hosted plan destinations', () => {
  it.each([
    ['community', SELF_HOSTED_PLAN_URLS.community],
    ['premium', SELF_HOSTED_PLAN_URLS.premium],
    ['enterprise', SELF_HOSTED_PLAN_URLS.enterprise],
  ] as const)('links the %s plan to its purchase or download destination', (plan, href) => {
    render(<SelfHostedPlanItem plan={plan} />)

    expect(screen.getByRole('heading', { name: `billing.plans.${plan}.name` })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: new RegExp(`billing.plans.${plan}.btnText`) }),
    ).toHaveAttribute('href', href)
  })
})
