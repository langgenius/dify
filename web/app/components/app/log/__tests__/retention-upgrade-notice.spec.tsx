import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { defaultPlan } from '@/app/components/billing/config'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { RetentionUpgradeNotice } from '../retention-upgrade-notice'

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: vi.fn(),
  }
})

vi.mock('@/context/modal-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/modal-context')>()
  return {
    ...actual,
    useModalContext: vi.fn(),
  }
})

const mockUseProviderContext = vi.mocked(useProviderContext)
const mockUseModalContext = vi.mocked(useModalContext)

describe('RetentionUpgradeNotice', () => {
  const setShowPricingModal = vi.fn()

  function mockProvider({
    enableBilling = true,
    isFetchedPlan = true,
    isFetchedPlanInfo = true,
    planType = 'sandbox',
  }: {
    enableBilling?: boolean
    isFetchedPlan?: boolean
    isFetchedPlanInfo?: boolean
    planType?: CloudPlan
  } = {}) {
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({
        enableBilling,
        isFetchedPlan,
        isFetchedPlanInfo,
        plan: {
          ...defaultPlan,
          type: planType,
        },
      }),
    )
  }

  function renderNotice(deploymentEdition: DeploymentEdition = 'CLOUD') {
    const { wrapper } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: deploymentEdition },
    })
    return render(<RetentionUpgradeNotice />, { wrapper })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockProvider()
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
      provider: { planType: 'professional' },
      deploymentEdition: 'CLOUD',
    },
    {
      name: 'self-hosted sandbox workspaces',
      provider: { planType: 'sandbox' },
      deploymentEdition: 'COMMUNITY',
    },
    {
      name: 'workspaces without billing',
      provider: { enableBilling: false },
      deploymentEdition: 'CLOUD',
    },
    {
      name: 'workspaces before plan loading completes',
      provider: { isFetchedPlan: false, isFetchedPlanInfo: false },
      deploymentEdition: 'CLOUD',
    },
  ] as const)('should not show guidance for $name', ({ provider, deploymentEdition }) => {
    mockProvider(provider)

    renderNotice(deploymentEdition)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
