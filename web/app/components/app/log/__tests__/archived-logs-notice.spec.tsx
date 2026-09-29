import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { ArchivedLogsNotice } from '../archived-logs-notice'

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => ({
    isCurrentWorkspaceManager: true,
  }))
})

const setSettingsDestination = vi.fn()
vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return { ...actual, useQueryState: () => [null, setSettingsDestination] }
})

let plan: CloudPlan = 'professional'

describe('ArchivedLogsNotice', () => {
  const renderNotice = () => {
    const { wrapper } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { billing: { subscription: { plan } } },
    })
    return render(<ArchivedLogsNotice />, { wrapper })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    plan = 'professional'
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
    plan = 'sandbox'

    renderNotice()

    expect(screen.queryByText('appLog.archives.notice.description')).not.toBeInTheDocument()
  })
})
