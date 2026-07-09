import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MCPList from '../index'

type MockProvider = {
  id: string
  name: string | Record<string, string>
  type: string
}

type MockDetail = MockProvider | undefined

// Mock dependencies
const mockRefetch = vi.fn()
const mockUseAllToolProviders = vi.fn()
let mockProviders: MockProvider[] = []
let mockIsLoadingToolProviders = false
const mockAppContextState = vi.hoisted(() => ({
  workspacePermissionKeys: ['mcp.manage'] as string[],
  workspacePermissionKeysAtom: Symbol('workspacePermissionKeysAtom'),
}))

vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: (enabled?: boolean) => {
    mockUseAllToolProviders(enabled)
    return {
      data: mockProviders,
      isLoading: mockIsLoadingToolProviders,
      refetch: mockRefetch,
    }
  },
}))

vi.mock('@/context/app-context-state', () => ({
  workspacePermissionKeysAtom: mockAppContextState.workspacePermissionKeysAtom,
}))

vi.mock('jotai', () => ({
  useAtomValue: (atom: unknown) => {
    if (atom === mockAppContextState.workspacePermissionKeysAtom)
      return mockAppContextState.workspacePermissionKeys

    throw new Error('Unexpected atom')
  },
}))

vi.mock('@/app/components/tools/provider/tool-card-skeleton', () => ({
  default: ({ variant }: { variant?: string }) => (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} data-testid="mcp-card-skeleton" data-variant={variant}>Loading MCP</div>
      ))}
    </>
  ),
}))

// Mock child components
vi.mock('../create-card', () => ({
  default: ({ handleCreate }: { handleCreate: (provider: { id: string, name: string }) => void }) => (
    <button data-testid="create-card" type="button" onClick={() => handleCreate({ id: 'new-id', name: 'New Provider' })}>
      Create Card
    </button>
  ),
}))

vi.mock('../provider-card', () => ({
  default: ({ data, handleSelect, onUpdate, onDeleted }: { data: MockProvider, handleSelect: (id: string) => void, onUpdate: (id: string) => void, onDeleted: () => void }) => {
    const displayName = typeof data.name === 'string' ? data.name : Object.values(data.name)[0]
    return (
      <div data-testid={`provider-card-${data.id}`}>
        <button type="button" onClick={() => handleSelect(data.id)}>{displayName}</button>
        <button data-testid={`update-btn-${data.id}`} onClick={() => onUpdate(data.id)}>Update</button>
        <button data-testid={`delete-btn-${data.id}`} onClick={onDeleted}>Delete</button>
      </div>
    )
  },
}))

vi.mock('../detail/provider-detail', () => ({
  default: ({ detail, onHide, onUpdate, isTriggerAuthorize, onFirstCreate }: { detail: MockDetail, onHide: () => void, onUpdate: () => void, isTriggerAuthorize: boolean, onFirstCreate: () => void }) => {
    const displayName = detail?.name
      ? (typeof detail.name === 'string' ? detail.name : Object.values(detail.name)[0])
      : ''
    return (
      <div data-testid="detail-panel">
        <div data-testid="detail-name">{displayName}</div>
        <div data-testid="trigger-authorize">{isTriggerAuthorize ? 'true' : 'false'}</div>
        <button data-testid="close-detail" onClick={onHide}>Close</button>
        <button data-testid="update-detail" onClick={onUpdate}>Update List</button>
        <button data-testid="first-create-done" onClick={onFirstCreate}>First Create Done</button>
      </div>
    )
  },
}))

describe('MCPList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockProviders = []
    mockIsLoadingToolProviders = false
    mockAppContextState.workspacePermissionKeys = ['mcp.manage']
    mockRefetch.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<MCPList searchText="" />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })

    it('should render create card', () => {
      render(<MCPList searchText="" />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })

    it('should render providers read-only when user lacks mcp.manage', () => {
      mockAppContextState.workspacePermissionKeys = []
      mockProviders = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
      ]

      render(<MCPList searchText="" />)

      expect(mockUseAllToolProviders).toHaveBeenCalledWith(undefined)
      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
      expect(screen.queryByTestId('create-card')).not.toBeInTheDocument()
    })

    it('should hide create card when parent moves creation into the toolbar', () => {
      mockProviders = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
      ]

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
      mockProviders = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
      ]
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
        { id: '1', name: { 'en-US': 'Search Tool' }, type: 'mcp' },
        { id: '2', name: { 'en-US': 'Another Provider' }, type: 'mcp' },
        { id: '3', name: { 'en-US': 'Search API Tool' }, type: 'api' },
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
      mockProviders = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
      ]
    })

    it('should call refetch and set provider after update', async () => {
      render(<MCPList searchText="" />)

      const updateBtn = screen.getByTestId('update-btn-1')

      await act(async () => {
        fireEvent.click(updateBtn)
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(mockRefetch).toHaveBeenCalled()
    })

    it('should show detail panel with trigger authorize after update', async () => {
      render(<MCPList searchText="" />)

      const updateBtn = screen.getByTestId('update-btn-1')

      await act(async () => {
        fireEvent.click(updateBtn)
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
      expect(screen.getByTestId('trigger-authorize')).toHaveTextContent('true')
    })
  })

  describe('Delete Provider', () => {
    beforeEach(() => {
      mockProviders = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
      ]
    })

    it('should call refetch after delete', async () => {
      render(<MCPList searchText="" />)

      const deleteBtn = screen.getByTestId('delete-btn-1')

      await act(async () => {
        fireEvent.click(deleteBtn)
        vi.advanceTimersByTime(10)
      })

      expect(mockRefetch).toHaveBeenCalled()
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
