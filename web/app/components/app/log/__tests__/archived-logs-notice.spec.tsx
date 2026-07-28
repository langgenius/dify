import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContextSelector } from '@/context/modal-context'
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

vi.mock('@/context/modal-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/modal-context')>()
  return {
    ...actual,
    useModalContextSelector: vi.fn(),
  }
})

const mockUseProviderContext = vi.mocked(useProviderContext)
const mockUseModalContextSelector = vi.mocked(useModalContextSelector)

function mockProviderPlan(planType: Plan) {
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
  const setShowAccountSettingModal = vi.fn()
  const renderNotice = () => {
    const { wrapper } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: 'CLOUD' },
    })
    return render(<ArchivedLogsNotice />, { wrapper })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderPlan(Plan.professional)
    mockUseModalContextSelector.mockImplementation((selector) =>
      selector({
        setShowAccountSettingModal,
      } as unknown as Parameters<typeof selector>[0]),
    )
  })

  it('should show an accessible notice for paid workspace managers', async () => {
    const user = userEvent.setup()
    renderNotice()

    const notice = screen.getByRole('status')
    expect(notice).toHaveAttribute('aria-live', 'polite')
    expect(notice).toHaveAttribute('aria-atomic', 'true')
    expect(within(notice).getByText('appLog.archives.notice.description')).toBeInTheDocument()

    await user.click(within(notice).getByRole('button', { name: 'appLog.archives.notice.action' }))
    expect(setShowAccountSettingModal).toHaveBeenCalledWith({
      payload: ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES,
    })
  })

  it('should not show notice for sandbox workspaces', () => {
    mockProviderPlan(Plan.sandbox)

    renderNotice()

    expect(screen.queryByText('appLog.archives.notice.description')).not.toBeInTheDocument()
  })
})
