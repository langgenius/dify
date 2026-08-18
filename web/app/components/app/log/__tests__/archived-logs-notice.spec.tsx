import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { defaultPlan } from '@/app/components/billing/config'
import { useProviderContext } from '@/context/provider-context'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { ArchivedLogsNotice } from '../archived-logs-notice'

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => ({
    isCurrentWorkspaceManager: true,
  }))
})

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: vi.fn(),
  }
})

const setSettingsDestination = vi.fn()
vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return { ...actual, useQueryState: () => [null, setSettingsDestination] }
})

const mockUseProviderContext = vi.mocked(useProviderContext)

function mockProviderPlan(planType: CloudPlan) {
  mockUseProviderContext.mockReturnValue(
    createMockProviderContextValue({
      enableBilling: true,
      plan: {
        ...defaultPlan,
        type: planType,
      },
    }),
  )
}

describe('ArchivedLogsNotice', () => {
  const renderNotice = () => {
    const { wrapper } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: 'CLOUD' },
    })
    return render(<ArchivedLogsNotice />, { wrapper })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderPlan('professional')
  })

  it('should show an accessible notice for paid workspace managers', async () => {
    const user = userEvent.setup()
    renderNotice()

    const notice = screen.getByRole('status')
    expect(notice).toHaveAttribute('aria-live', 'polite')
    expect(notice).toHaveAttribute('aria-atomic', 'true')
    expect(within(notice).getByText('appLog.archives.notice.description')).toBeInTheDocument()

    await user.click(within(notice).getByRole('button', { name: 'appLog.archives.notice.action' }))
    expect(setSettingsDestination).toHaveBeenCalledWith('workflow-log-archives')
  })

  it('should not show notice for sandbox workspaces', () => {
    mockProviderPlan('sandbox')

    renderNotice()

    expect(screen.queryByText('appLog.archives.notice.description')).not.toBeInTheDocument()
  })
})
