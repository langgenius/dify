import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useModalContext } from '@/context/modal-context'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { RetentionUpgradeNotice } from '../retention-upgrade-notice'

vi.mock('@/context/modal-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/modal-context')>()
  return {
    ...actual,
    useModalContext: vi.fn(),
  }
})

const mockUseModalContext = vi.mocked(useModalContext)

describe('RetentionUpgradeNotice', () => {
  const setShowPricingModal = vi.fn()

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
    mockUseModalContext.mockReturnValue({
      setShowPricingModal,
    } as unknown as ReturnType<typeof useModalContext>)
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
    expect(setShowPricingModal).toHaveBeenCalledOnce()
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
