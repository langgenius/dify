import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UsageLimitsPage from '../index'

const mockState = vi.hoisted(() => ({
  workspace: { id: 'workspace-id', name: 'Test Workspace', max_active_requests: 5 },
  manager: true,
  loading: false,
  update: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  setWorkspace: (_workspace: { id: string; name: string; max_active_requests: number }) => {},
  setManager: (_manager: boolean) => {},
  setLoading: (_loading: boolean) => {},
}))

vi.mock('@/context/workspace-state', async () => {
  const { atom, getDefaultStore } = await import('jotai')
  const workspaceAtom = atom(mockState.workspace)
  const managerAtom = atom(mockState.manager)
  const loadingAtom = atom(mockState.loading)
  const store = getDefaultStore()
  mockState.setWorkspace = (workspace) => store.set(workspaceAtom, workspace)
  mockState.setManager = (manager) => store.set(managerAtom, manager)
  mockState.setLoading = (loading) => store.set(loadingAtom, loading)
  return {
    currentWorkspaceAtom: workspaceAtom,
    currentWorkspaceLoadingAtom: loadingAtom,
    isCurrentWorkspaceManagerAtom: managerAtom,
  }
})

vi.mock('@/service/console', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        settings: {
          post: {
            mutationOptions: () => ({ mutationFn: mockState.update }),
          },
        },
        summary: {
          get: { queryKey: () => ['workspace-summary'] },
        },
      },
    },
  },
}))

vi.mock('@/app/notifications', () => ({
  toast: { success: mockState.success, error: mockState.error },
}))

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <UsageLimitsPage />
    </QueryClientProvider>,
  )
}

const getLimitInput = () =>
  screen.getByRole('spinbutton', {
    name: 'common.usageLimits.maxActiveRequests.label',
  })
const getSaveButton = () => screen.getByRole('button', { name: 'common.operation.save' })

describe('UsageLimitsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.workspace = { id: 'workspace-id', name: 'Test Workspace', max_active_requests: 5 }
    mockState.manager = true
    mockState.loading = false
    mockState.setWorkspace(mockState.workspace)
    mockState.setManager(true)
    mockState.setLoading(false)
    mockState.update.mockResolvedValue({ result: 'success' })
  })

  it('shows the current workspace limit', () => {
    renderPage()

    expect(getLimitInput()).toHaveValue(5)
  })

  it('prevents non-managers from changing the limit', () => {
    mockState.manager = false
    mockState.setManager(false)
    renderPage()

    expect(getLimitInput()).toBeDisabled()
    expect(getSaveButton()).toBeDisabled()
  })

  it('saves a valid limit through the workspace API', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.clear(getLimitInput())
    await user.type(getLimitInput(), '12')
    await user.click(getSaveButton())

    await waitFor(() => {
      expect(mockState.update).toHaveBeenCalledWith(
        { body: { max_active_requests: 12 } },
        expect.anything(),
      )
      expect(mockState.success).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully')
    })
  })

  it('rejects negative limits', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.clear(getLimitInput())
    await user.type(getLimitInput(), '-1')

    expect(getSaveButton()).toBeDisabled()
    expect(mockState.update).not.toHaveBeenCalled()
  })

  it('reports a save failure', async () => {
    const user = userEvent.setup()
    mockState.update.mockRejectedValue(new Error('update failed'))
    renderPage()

    await user.clear(getLimitInput())
    await user.type(getLimitInput(), '8')
    await user.click(getSaveButton())

    await waitFor(() => {
      expect(mockState.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    })
  })
})
