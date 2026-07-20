import { render, screen, waitFor } from '@testing-library/react'
import AgentsAccessGuard from '../agents-access-guard'

const mockReplace = vi.fn()
const mockAccessState = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAccessState())
})

vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAccessState())
})

vi.mock('jotai', async (importOriginal) => {
  const { createDatasetAccessJotaiMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessJotaiMock(importOriginal)
})

type AccessStateMock = {
  isLoadingCurrentWorkspace: boolean
  isLoadingWorkspacePermissionKeys: boolean
  workspacePermissionKeys: string[]
  currentWorkspace: { id: string }
}

const baseState: AccessStateMock = {
  isLoadingCurrentWorkspace: false,
  isLoadingWorkspacePermissionKeys: false,
  workspacePermissionKeys: ['agent.manage'],
  currentWorkspace: { id: 'workspace-1' },
}

const setAccessState = (overrides: Partial<AccessStateMock> = {}) => {
  mockAccessState.mockReturnValue({ ...baseState, ...overrides })
}

describe('AgentsAccessGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAccessState()
  })

  it('renders loading while the workspace is loading', () => {
    setAccessState({ isLoadingCurrentWorkspace: true, currentWorkspace: { id: '' } })

    render(
      <AgentsAccessGuard>
        <div>agents</div>
      </AgentsAccessGuard>,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('agents')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('renders loading while workspace permission keys are loading', () => {
    setAccessState({ isLoadingWorkspacePermissionKeys: true, workspacePermissionKeys: [] })

    render(
      <AgentsAccessGuard>
        <div>agents</div>
      </AgentsAccessGuard>,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('agents')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('redirects to /apps without agent.manage', async () => {
    setAccessState({ workspacePermissionKeys: ['dataset.create_and_management'] })

    render(
      <AgentsAccessGuard>
        <div>agents</div>
      </AgentsAccessGuard>,
    )

    expect(screen.queryByText('agents')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })

  it('renders children with agent.manage', () => {
    render(
      <AgentsAccessGuard>
        <div>agents</div>
      </AgentsAccessGuard>,
    )

    expect(screen.getByText('agents')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
