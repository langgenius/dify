import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MCPList from './index'

type MockProvider = {
  id: string
  name: string | Record<string, string>
  type: string
}

type MockDetail = MockProvider | undefined

// Mock dependencies
const mockRefetch = vi.fn()
let mockProviders: MockProvider[] = []

vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: () => ({
    data: mockProviders,
    refetch: mockRefetch,
  }),
}))

// Mock child components
vi.mock('./create-card', () => ({
  default: ({ handleCreate }: { handleCreate: (provider: { id: string, name: string }) => void }) => (
    <div data-testid="create-card" onClick={() => handleCreate({ id: 'new-id', name: 'New Provider' })}>
      Create Card
    </div>
  ),
}))

vi.mock('./provider-card', () => ({
  default: ({ data, handleSelect, onUpdate, onDeleted }: { data: MockProvider, handleSelect: (id: string) => void, onUpdate: (id: string) => void, onDeleted: () => void }) => {
    const displayName = typeof data.name === 'string' ? data.name : Object.values(data.name)[0]
    return (
      <div data-testid={`provider-card-${data.id}`}>
        <span onClick={() => handleSelect(data.id)}>{displayName}</span>
        <button data-testid={`update-btn-${data.id}`} onClick={() => onUpdate(data.id)}>Update</button>
        <button data-testid={`delete-btn-${data.id}`} onClick={onDeleted}>Delete</button>
      </div>
    )
  },
}))

vi.mock('./detail/provider-detail', () => ({
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

    it('should render default skeleton cards when list is empty', () => {
      render(<MCPList searchText="" />)

      // Should render skeleton cards when no providers
      const container = document.querySelector('.grid')
      expect(container).toBeInTheDocument()
      // Check for skeleton cards (36 of them)
      const skeletonCards = document.querySelectorAll('.h-\\[111px\\]')
      expect(skeletonCards.length).toBe(36)
    })

    it('should not render skeleton cards when providers exist', () => {
      mockProviders = [
        { id: '1', name: 'Provider 1', type: 'mcp' },
      ]
      render(<MCPList searchText="" />)

      const skeletonCards = document.querySelectorAll('.h-\\[111px\\]')
      expect(skeletonCards.length).toBe(0)
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
      ]
    })

    it('should filter providers based on search text', () => {
      render(<MCPList searchText="search" />)

      expect(screen.getByTestId('provider-card-1')).toBeInTheDocument()
      expect(screen.queryByTestId('provider-card-2')).not.toBeInTheDocument()
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
    it('should have responsive grid layout', () => {
      render(<MCPList searchText="" />)

      const grid = document.querySelector('.grid')
      expect(grid).toHaveClass('grid-cols-1')
      expect(grid).toHaveClass('md:grid-cols-2')
      expect(grid).toHaveClass('xl:grid-cols-4')
    })

    it('should have overflow hidden when list is empty', () => {
      mockProviders = []
      render(<MCPList searchText="" />)

      const grid = document.querySelector('.grid')
      expect(grid).toHaveClass('overflow-hidden')
    })

    it('should not have overflow hidden when list has providers', () => {
      mockProviders = [{ id: '1', name: 'Provider 1', type: 'mcp' }]
      render(<MCPList searchText="" />)

      const grid = document.querySelector('.grid')
      expect(grid).not.toHaveClass('overflow-hidden')
    })
  })
})
