import type { ToolWithProvider } from '@/app/components/workflow/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import MCPList from '../index'

type MockProvider = {
  id: string
  name: string
  type: 'mcp' | 'api'
}

type MockDetail = MockProvider | undefined

// Mock dependencies
const mockRefetch = vi.fn()
const mockUpdateMCP = vi.fn()
const mockDeleteMCP = vi.fn()
const getProviders = vi.fn()
let mockProviders: MockProvider[] = []
let seedProviders = true
const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['mcp.manage'] as string[],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

vi.mock('@/app/components/tools/provider/tool-card-skeleton', () => ({
  default: ({ variant }: { variant?: string }) => (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} data-testid="mcp-card-skeleton" data-variant={variant}>
          Loading MCP
        </div>
      ))}
    </>
  ),
}))

// Mock child components
vi.mock('../create-card', () => ({
  default: ({
    handleCreate,
  }: {
    handleCreate: (provider: { id: string; name: string }) => void
  }) => (
    <button
      data-testid="create-card"
      type="button"
      onClick={() => handleCreate({ id: 'new-id', name: 'New Provider' })}
    >
      Create Card
    </button>
  ),
}))

vi.mock('../provider-card', () => ({
  default: ({
    data,
    handleSelect,
    onEdit,
    onDelete,
  }: {
    data: MockProvider
    handleSelect: (id: string) => void
    onEdit: (id: string) => void
    onDelete: (id: string) => void
  }) => {
    return (
      <div data-testid={`provider-card-${data.id}`}>
        <button type="button" onClick={() => handleSelect(data.id)}>
          {data.name}
        </button>
        <button data-testid={`edit-btn-${data.id}`} onClick={() => onEdit(data.id)}>
          Edit
        </button>
        <button data-testid={`delete-btn-${data.id}`} onClick={() => onDelete(data.id)}>
          Delete
        </button>
      </div>
    )
  },
}))

vi.mock('../detail/provider-detail', () => ({
  default: ({
    detail,
    onHide,
    onUpdate,
    onEdit,
    onDelete,
    isTriggerAuthorize,
    onFirstCreate,
  }: {
    detail: MockDetail
    onHide: () => void
    onUpdate: () => void
    onEdit: (id: string) => void
    onDelete: (id: string) => void
    isTriggerAuthorize: boolean
    onFirstCreate: () => void
  }) => {
    const displayName = detail?.name ?? ''
    return (
      <div data-testid="detail-panel">
        <div data-testid="detail-name">{displayName}</div>
        <div data-testid="trigger-authorize">{isTriggerAuthorize ? 'true' : 'false'}</div>
        <button data-testid="close-detail" onClick={onHide}>
          Close
        </button>
        <button data-testid="update-detail" onClick={onUpdate}>
          Update List
        </button>
        <button data-testid="edit-detail" onClick={() => detail && onEdit(detail.id)}>
          Edit
        </button>
        <button data-testid="delete-detail" onClick={() => detail && onDelete(detail.id)}>
          Delete
        </button>
        <button data-testid="first-create-done" onClick={onFirstCreate}>
          First Create Done
        </button>
      </div>
    )
  },
}))

vi.mock('../modal', () => ({
  default: ({
    show,
    data,
    onConfirm,
    onHide,
  }: {
    show: boolean
    data?: MockProvider
    onConfirm: (form: { name: string; server_url: string }) => void
    onHide: () => void
  }) =>
    show ? (
      <div role="dialog" aria-label="Edit MCP">
        <div>{data?.name as string}</div>
        <button
          type="button"
          onClick={() => onConfirm({ name: 'Updated MCP', server_url: 'https://updated.com' })}
        >
          Save
        </button>
        <button type="button" onClick={onHide}>
          Cancel
        </button>
      </div>
    ) : null,
}))

const providersResponse = () => mockProviders.map((provider) => createToolProviderFixture(provider))
const render = (ui: React.ReactElement) => {
  const queryClient = createConsoleQueryClient()
  if (seedProviders)
    queryClient.setQueryData<ReturnType<typeof providersResponse>>(
      consoleQuery.workspaces.current.tools.mcp.get.queryKey(),
      providersResponse(),
    )
  return renderWithConsoleQuery(ui, { queryClient })
}
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.mcp.get': (input) => getProviders(input),
      'workspaces.current.toolProvider.mcp.put': (input) => mockUpdateMCP(input),
      'workspaces.current.toolProvider.mcp.delete': (input) => mockDeleteMCP(input),
    }),
  }
})

describe('MCPList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviders = []
    seedProviders = true
    getProviders.mockImplementation(() => Promise.resolve(providersResponse()))
    mockConsoleState.workspacePermissionKeys = ['mcp.manage']
    mockRefetch.mockResolvedValue(undefined)
    mockUpdateMCP.mockResolvedValue({ result: 'success' })
    mockDeleteMCP.mockResolvedValue({ result: 'success' })
  })

  describe('Rendering', () => {
    it('uses parent-provided MCP data without starting its fallback query', () => {
      const providers = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
      ] as unknown as ToolWithProvider[]

      render(
        <MCPList providers={providers} isLoading={false} onRefresh={mockRefetch} searchText="" />,
      )

      expect(getProviders).not.toHaveBeenCalled()
      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
    })

    it('should render providers read-only when user lacks mcp.manage', async () => {
      seedProviders = false
      mockConsoleState.workspacePermissionKeys = []
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]

      render(<MCPList searchText="" />)

      await waitFor(() => expect(getProviders).toHaveBeenCalled())
      expect(await screen.findByTestId('provider-card-1')).toBeInTheDocument()
      expect(screen.queryByTestId('create-card')).not.toBeInTheDocument()
    })

    it('should hide create card when parent moves creation into the toolbar', () => {
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]

      render(<MCPList searchText="" showCreateCard={false} />)

      expect(screen.queryByTestId('create-card')).not.toBeInTheDocument()
      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
    })

    it('should render card skeletons while tool providers are loading', () => {
      seedProviders = false
      getProviders.mockReturnValue(new Promise(() => {}))
      render(<MCPList searchText="" />)

      expect(screen.getAllByTestId('mcp-card-skeleton')).toHaveLength(6)
      expect(screen.getAllByTestId('mcp-card-skeleton')[0]).toHaveAttribute('data-variant', 'mcp')
      expect(screen.queryByTestId('create-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('provider-card-1')).not.toBeInTheDocument()
    })
  })

  describe('With Providers', () => {
    beforeEach(() => {
      mockProviders = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
        { id: '2', name: 'Provider 2', type: 'mcp' },
        { id: '3', name: 'API Tool', type: 'api' },
      ]
    })

    it('should render provider cards for MCP type providers', () => {
      render(<MCPList searchText="" />)

      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
      expect(screen.getByTestId('provider-card-2')).toBeInTheDocument()
      // API type should not be rendered (only MCP type)
      expect(screen.queryByTestId('provider-card-3')).not.toBeInTheDocument()
    })

    it('should hide detail panel when close is clicked', async () => {
      const user = userEvent.setup()
      render(<MCPList searchText="" />)

      const providerName = screen.getByText('Provider 1')

      await act(async () => {
        await user.click(providerName)
      })

      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()

      const closeBtn = screen.getByTestId('close-detail')

      await act(async () => {
        await user.click(closeBtn)
      })

      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()
    })
  })

  describe('Search Filtering', () => {
    beforeEach(() => {
      mockProviders = [
        { id: '1', name: 'Search Tool', type: 'mcp' },
        { id: '2', name: 'Another Provider', type: 'mcp' },
        { id: '3', name: 'Search API Tool', type: 'api' },
      ]
    })

    it('should filter providers based on search text', () => {
      render(<MCPList searchText="SEARCH" />)

      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
      expect(screen.queryByTestId('provider-card-2')).not.toBeInTheDocument()
      expect(screen.queryByTestId('provider-card-3')).not.toBeInTheDocument()
    })
  })

  describe('Create Provider', () => {
    beforeEach(() => {
      mockProviders = []
    })

    it('should reset trigger authorize when onFirstCreate is called', async () => {
      const user = userEvent.setup()
      mockProviders = [{ id: 'new-id', name: 'New Provider', type: 'mcp' }]

      render(<MCPList searchText="" />)

      const createCard = screen.getByTestId('create-card')

      await act(async () => {
        await user.click(createCard)
        await Promise.resolve()
      })

      expect(screen.getByTestId('trigger-authorize')).toHaveTextContent('true')

      const firstCreateDone = screen.getByTestId('first-create-done')

      await act(async () => {
        await user.click(firstCreateDone)
      })

      expect(screen.getByTestId('trigger-authorize')).toHaveTextContent('false')
      expect(getProviders).toHaveBeenCalled()
    })

    it('should refetch and open detail when provider is created from the toolbar', async () => {
      mockProviders = [{ id: 'toolbar-id', name: 'Toolbar Provider', type: 'mcp' }]
      const onCreatedProviderHandled = vi.fn()

      await act(async () => {
        render(
          <MCPList
            searchText=""
            createdProviderId="toolbar-id"
            showCreateCard={false}
            onCreatedProviderHandled={onCreatedProviderHandled}
          />,
        )
        await Promise.resolve()
      })

      expect(getProviders).toHaveBeenCalled()
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
      expect(screen.getByTestId('detail-name')).toHaveTextContent('Toolbar Provider')
      expect(screen.getByTestId('trigger-authorize')).toHaveTextContent('true')
      expect(onCreatedProviderHandled).toHaveBeenCalled()
    })
  })

  describe('Update Provider', () => {
    beforeEach(() => {
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]
    })

    it('should open only the edit dialog when edit is selected from a card', async () => {
      const user = userEvent.setup()
      render(<MCPList searchText="" />)

      await user.click(screen.getByTestId('edit-btn-1'))

      expect(screen.getByRole('dialog', { name: 'Edit MCP' })).toBeInTheDocument()
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()
    })

    it('should replace detail with the edit dialog and restore detail on cancel', async () => {
      const user = userEvent.setup()
      render(<MCPList searchText="" />)

      await user.click(screen.getByText('Provider 1'))
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()

      await user.click(screen.getByTestId('edit-detail'))
      expect(screen.getByRole('dialog', { name: 'Edit MCP' })).toBeInTheDocument()
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog', { name: 'Edit MCP' })).not.toBeInTheDocument()
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
    })

    it('should show detail panel with trigger authorize after update', async () => {
      const user = userEvent.setup()
      render(<MCPList searchText="" />)

      const updateBtn = screen.getByTestId('edit-btn-1')

      await user.click(updateBtn)

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Save' }))
        await Promise.resolve()
      })

      expect(mockUpdateMCP).toHaveBeenCalledWith({
        body: {
          name: 'Updated MCP',
          server_url: 'https://updated.com',
          provider_id: '1',
        },
      })
      expect(getProviders).toHaveBeenCalled()
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
      expect(screen.getByTestId('trigger-authorize')).toHaveTextContent('true')
    })
  })

  describe('Delete Provider', () => {
    beforeEach(() => {
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]
    })

    it('should replace detail with delete confirmation and restore detail on cancel', async () => {
      const user = userEvent.setup()
      render(<MCPList searchText="" />)

      await user.click(screen.getByText('Provider 1'))
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()

      await user.click(screen.getByTestId('delete-detail'))
      expect(screen.getByText('tools.mcp.delete')).toBeInTheDocument()
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
    })

    it('should restore detail when the delete dialog requests close', async () => {
      const user = userEvent.setup()
      render(<MCPList searchText="" />)

      await user.click(screen.getByText('Provider 1'))
      await user.click(screen.getByTestId('delete-detail'))
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
    })

    it('should delete from a card without selecting it', async () => {
      const user = userEvent.setup()
      render(<MCPList searchText="" />)

      await user.click(screen.getByTestId('delete-btn-1'))
      expect(screen.getByText('tools.mcp.delete')).toBeInTheDocument()

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
        await Promise.resolve()
      })

      expect(mockDeleteMCP).toHaveBeenCalledWith({ body: { provider_id: '1' } })
      expect(getProviders).toHaveBeenCalled()
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()
    })

    it('should keep delete confirmation open when deletion fails', async () => {
      const user = userEvent.setup()
      mockDeleteMCP.mockResolvedValue({ result: 'error' })
      render(<MCPList searchText="" />)

      await user.click(screen.getByTestId('delete-btn-1'))

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
        await Promise.resolve()
      })

      expect(getProviders).not.toHaveBeenCalled()
      expect(screen.getByText('tools.mcp.delete')).toBeInTheDocument()
    })
  })
})
