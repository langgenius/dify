import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { render as renderWithoutPricing } from '@/test/console/render'
import { RetentionUpgradeNotice } from '../retention-upgrade-notice'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('RetentionUpgradeNotice', () => {
  function renderNotice(
    deploymentEdition: DeploymentEdition = 'CLOUD',
    plan: CloudPlan | null = 'sandbox',
  ) {
    const { wrapper, queryClient } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: deploymentEdition },
    })
    if (plan) seedFeatures(queryClient, { billing: { subscription: { plan } } })
    else {
      void queryClient.query({
        queryKey: consoleQuery.features.get.queryKey(),
        queryFn: () => new Promise(() => {}),
      })
    }
    return render(<RetentionUpgradeNotice />, { wrapper })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show accessible upgrade guidance for Cloud sandbox workspaces', async () => {
    const user = userEvent.setup()
    renderNotice()

    const notice = screen.getByRole('status')
    expect(notice).toHaveAttribute('aria-live', 'polite')
    expect(notice).toHaveAttribute('aria-atomic', 'true')
    expect(within(notice).getByText('appLog.retention.upgradeTip.description')).toBeInTheDocument()

    await user.click(
      within(notice).getByRole('button', { name: 'billing.upgradeBtn.encourageShort' }),
    )
    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
  })

  it.each([
    {
      name: 'paid Cloud workspaces',
      plan: 'professional',
      deploymentEdition: 'CLOUD',
    },
    {
      name: 'self-hosted sandbox workspaces',
      plan: 'sandbox',
      deploymentEdition: 'COMMUNITY',
    },
    {
      name: 'Enterprise workspaces',
      plan: 'sandbox',
      deploymentEdition: 'ENTERPRISE',
    },
    {
      name: 'workspaces before plan loading completes',
      plan: null,
      deploymentEdition: 'CLOUD',
    },
  ] as const)('should not show guidance for $name', ({ plan, deploymentEdition }) => {
    renderNotice(deploymentEdition, plan)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
