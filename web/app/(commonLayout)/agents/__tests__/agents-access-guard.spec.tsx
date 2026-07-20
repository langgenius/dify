import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/console/render'
import AgentsAccessGuard from '../agents-access-guard'

const mockReplace = vi.fn()
const mockConsoleStateReader = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => mockConsoleStateReader())
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => mockConsoleStateReader())
})

type ConsoleStateFixture = {
  isLoadingCurrentWorkspace: boolean
  isLoadingWorkspacePermissionKeys: boolean
  workspacePermissionKeys: string[]
  currentWorkspace: {
    id: string
  }
}

const baseContext: ConsoleStateFixture = {
  isLoadingCurrentWorkspace: false,
  isLoadingWorkspacePermissionKeys: false,
  workspacePermissionKeys: ['agent.manage'],
  currentWorkspace: {
    id: 'workspace-1',
  },
}

const setConsoleState = (overrides: Partial<ConsoleStateFixture> = {}) => {
  mockConsoleStateReader.mockReturnValue({
    ...baseContext,
    ...overrides,
  })
}

describe('AgentsAccessGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setConsoleState()
  })

  it('renders loading while the workspace is loading', () => {
    setConsoleState({ isLoadingCurrentWorkspace: true, currentWorkspace: { id: '' } })

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
    setConsoleState({ isLoadingWorkspacePermissionKeys: true, workspacePermissionKeys: [] })

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
    setConsoleState({ workspacePermissionKeys: ['dataset.create_and_management'] })

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
