import type { ToolWithProvider } from '@/app/components/workflow/types'
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@/test/console/render'
import MCPList from '../index'

type MockProvider = {
  id: string
  name: string
  type: string
}

type MockDetail = MockProvider | undefined

// Mock dependencies
const mockRefetch = vi.fn()
const mockUpdateMCP = vi.fn()
const mockDeleteMCP = vi.fn()
const mockUseAllMCPTools = vi.fn()
let mockProviders: MockProvider[] = []
let mockIsLoadingToolProviders = false
const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['mcp.manage'] as string[],
}))

vi.mock('@/service/use-tools', () => ({
  useAllMCPTools: (enabled?: boolean) => {
    mockUseAllMCPTools(enabled)
    return {
      data: mockProviders,
      isLoading: mockIsLoadingToolProviders,
      refetch: mockRefetch,
    }
  },
  useUpdateMCP: () => ({
    mutateAsync: mockUpdateMCP,
  }),
  useDeleteMCP: () => ({
    mutateAsync: mockDeleteMCP,
    isPending: false,
  }),
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

describe('MCPList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockProviders = []
    mockIsLoadingToolProviders = false
    mockConsoleState.workspacePermissionKeys = ['mcp.manage']
    mockRefetch.mockResolvedValue(undefined)
    mockUpdateMCP.mockResolvedValue({ result: 'success' })
    mockDeleteMCP.mockResolvedValue({ result: 'success' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('uses parent-provided MCP data without starting its fallback query', () => {
      const providers = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
      ] as unknown as ToolWithProvider[]

      render(
        <MCPList providers={providers} isLoading={false} onRefresh={mockRefetch} searchText="" />,
      )

      expect(mockUseAllMCPTools).toHaveBeenCalledWith(false)
      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
    })

    it('should render create card', () => {
      render(<MCPList searchText="" />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })

    it('should render providers read-only when user lacks mcp.manage', () => {
      mockConsoleState.workspacePermissionKeys = []
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]

      render(<MCPList searchText="" />)

      expect(mockUseAllMCPTools).toHaveBeenCalledWith(true)
      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
      expect(screen.queryByTestId('create-card')).not.toBeInTheDocument()
    })

    it('should hide create card when parent moves creation into the toolbar', () => {
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]

      render(<MCPList searchText="" showCreateCard={false} />)

      expect(screen.queryByTestId('create-card')).not.toBeInTheDocument()
      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
    })

    it('should render card skeletons while tool providers are loading', () => {
      mockIsLoadingToolProviders = true
      render(<MCPList searchText="" />)

      expect(screen.getAllByTestId('mcp-card-skeleton')).toHaveLength(6)
      expect(screen.getAllByTestId('mcp-card-skeleton')[0]).toHaveAttribute('data-variant', 'mcp')
      expect(screen.queryByTestId('create-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('provider-card-1')).not.toBeInTheDocument()
    })

    it('should not render card skeletons when the loaded list is empty', () => {
      render(<MCPList searchText="" />)

      expect(screen.queryByTestId('mcp-card-skeleton')).not.toBeInTheDocument()
    })

    it('should not render skeleton cards when providers exist', () => {
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]
      render(<MCPList searchText="" />)

      expect(screen.queryByTestId('mcp-card-skeleton')).not.toBeInTheDocument()
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

    it('should show detail panel when provider is selected', async () => {
      render(<MCPList searchText="" />)

      const providerName = screen.getByText('Provider 1')

      await act(async () => {
        fireEvent.click(providerName)
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
      expect(screen.getByTestId('detail-name')).toHaveTextContent('Provider 1')
    })

    it('should hide detail panel when close is clicked', async () => {
      render(<MCPList searchText="" />)

      const providerName = screen.getByText('Provider 1')

      await act(async () => {
        fireEvent.click(providerName)
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()

      const closeBtn = screen.getByTestId('close-detail')

      await act(async () => {
        fireEvent.click(closeBtn)
        vi.advanceTimersByTime(10)
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
      render(<MCPList searchText="search" />)

      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
      expect(screen.queryByTestId('provider-card-2')).not.toBeInTheDocument()
      expect(screen.queryByTestId('provider-card-3')).not.toBeInTheDocument()
    })

    it('should filter case-insensitively', () => {
      render(<MCPList searchText="SEARCH" />)

      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
    })

    it('should show all MCP type providers when search is empty', () => {
      mockProviders = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
        { id: '2', name: 'Provider 2', type: 'mcp' },
      ]
      render(<MCPList searchText="" />)

      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
      expect(screen.getByTestId('provider-card-2')).toBeInTheDocument()
    })
  })

  describe('Create Provider', () => {
    beforeEach(() => {
      mockProviders = []
    })

    it('should call refetch and set provider after create', async () => {
      render(<MCPList searchText="" />)

      const createCard = screen.getByTestId('create-card')

      await act(async () => {
        fireEvent.click(createCard)
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(mockRefetch).toHaveBeenCalled()
    })

    it('should show detail panel with trigger authorize after create', async () => {
      mockProviders = [{ id: 'new-id', name: 'New Provider', type: 'mcp' }]

      render(<MCPList searchText="" />)

      const createCard = screen.getByTestId('create-card')

      await act(async () => {
        fireEvent.click(createCard)
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
      expect(screen.getByTestId('trigger-authorize')).toHaveTextContent('true')
    })

    it('should reset trigger authorize when onFirstCreate is called', async () => {
      mockProviders = [{ id: 'new-id', name: 'New Provider', type: 'mcp' }]

      render(<MCPList searchText="" />)

      const createCard = screen.getByTestId('create-card')

      await act(async () => {
        fireEvent.click(createCard)
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(screen.getByTestId('trigger-authorize')).toHaveTextContent('true')

      const firstCreateDone = screen.getByTestId('first-create-done')

      await act(async () => {
        fireEvent.click(firstCreateDone)
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByTestId('trigger-authorize')).toHaveTextContent('false')
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

      expect(mockRefetch).toHaveBeenCalled()
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
      render(<MCPList searchText="" />)

      fireEvent.click(screen.getByTestId('edit-btn-1'))

      expect(screen.getByRole('dialog', { name: 'Edit MCP' })).toBeInTheDocument()
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()
    })

    it('should replace detail with the edit dialog and restore detail on cancel', () => {
      render(<MCPList searchText="" />)

      fireEvent.click(screen.getByText('Provider 1'))
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('edit-detail'))
      expect(screen.getByRole('dialog', { name: 'Edit MCP' })).toBeInTheDocument()
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog', { name: 'Edit MCP' })).not.toBeInTheDocument()
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
    })

    it('should show detail panel with trigger authorize after update', async () => {
      render(<MCPList searchText="" />)

      const updateBtn = screen.getByTestId('edit-btn-1')

      fireEvent.click(updateBtn)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(mockUpdateMCP).toHaveBeenCalledWith({
        name: 'Updated MCP',
        server_url: 'https://updated.com',
        provider_id: '1',
      })
      expect(mockRefetch).toHaveBeenCalled()
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
      expect(screen.getByTestId('trigger-authorize')).toHaveTextContent('true')
    })
  })

  describe('Delete Provider', () => {
    beforeEach(() => {
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]
    })

    it('should replace detail with delete confirmation and restore detail on cancel', () => {
      render(<MCPList searchText="" />)

      fireEvent.click(screen.getByText('Provider 1'))
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('delete-detail'))
      expect(screen.getByText('tools.mcp.delete')).toBeInTheDocument()
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
    })

    it('should restore detail when the delete dialog requests close', () => {
      render(<MCPList searchText="" />)

      fireEvent.click(screen.getByText('Provider 1'))
      fireEvent.click(screen.getByTestId('delete-detail'))
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
    })

    it('should delete from a card without selecting it', async () => {
      render(<MCPList searchText="" />)

      fireEvent.click(screen.getByTestId('delete-btn-1'))
      expect(screen.getByText('tools.mcp.delete')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(mockDeleteMCP).toHaveBeenCalledWith('1')
      expect(mockRefetch).toHaveBeenCalled()
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()
    })

    it('should keep delete confirmation open when deletion fails', async () => {
      mockDeleteMCP.mockResolvedValue({ result: 'error' })
      render(<MCPList searchText="" />)

      fireEvent.click(screen.getByTestId('delete-btn-1'))

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
        await Promise.resolve()
      })

      expect(mockRefetch).not.toHaveBeenCalled()
      expect(screen.getByText('tools.mcp.delete')).toBeInTheDocument()
    })
  })

  describe('Grid Layout', () => {
    it('should keep MCP cards to three columns at desktop width and above', () => {
      render(<MCPList searchText="" />)

      const grid = document.querySelector('.grid')
      expect(grid).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'md:grid-cols-3')
      expect(grid).not.toHaveClass('xl:grid-cols-4')
      expect(grid).not.toHaveClass('2xl:grid-cols-5')
      expect(grid).not.toHaveClass('2k:grid-cols-6')
    })

    it('should have overflow hidden while loading', () => {
      mockProviders = []
      mockIsLoadingToolProviders = true
      render(<MCPList searchText="" />)

      const grid = document.querySelector('.grid')
      expect(grid).toHaveClass('overflow-hidden')
    })

    it('should not have overflow hidden when loading is complete', () => {
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]
      render(<MCPList searchText="" />)

      const grid = document.querySelector('.grid')
      expect(grid).not.toHaveClass('overflow-hidden')
    })

    it('should use compact content inset when requested by parent layout', () => {
      render(<MCPList searchText="" contentInset="compact" />)

      const grid = document.querySelector('.grid')
      expect(grid).toHaveClass('px-6')
      expect(grid).toHaveClass('max-w-[1600px]')
      expect(grid).not.toHaveClass('px-12')
    })
  })
})
