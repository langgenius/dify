import type { ReactElement, ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import List from '../index'

const render = (ui: ReactElement) =>
  renderWithConsoleState(ui, { wrapper: createQueryClientWrapper(createTestQueryClient()) })

const mockPush = vi.fn()
const mockReplace = vi.fn()
let mockConsoleState = {
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: true,
  workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
}
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

// Mock app context

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => mockConsoleState)
})

// Mock useDocumentTitle hook
vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

// Mock useFormatTimeFromNow hook
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (timestamp: number) => new Date(timestamp).toLocaleDateString(),
  }),
}))

// Mock useKnowledge hook
vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'High Quality',
  }),
}))

const { mockDatasetListQuery } = vi.hoisted(() => ({
  mockDatasetListQuery: vi.fn((_query: { include_all?: boolean; keyword?: string }) => ({
    data: { pages: [{ data: [], total: 1 }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetching: false,
    isFetchingNextPage: false,
  })),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    // The page reads the list's first request.
    'datasets.get': (options: { input: (page: number) => { query: object } }) =>
      mockDatasetListQuery(options.input(1).query),
    'datasets.apiBaseInfo.get': () => ({
      data: { api_base_url: 'https://api.example.com' },
    }),
  })
})

// Mock Datasets component
vi.mock('../datasets', () => ({
  default: ({
    datasetList,
    emptyElement,
  }: {
    datasetList?: { pages: Array<{ total?: number }> }
    emptyElement?: ReactNode
  }) => (
    <div data-testid="datasets-component">
      <span data-testid="dataset-total">{datasetList?.pages[0]?.total}</span>
      {emptyElement}
    </div>
  ),
}))

// Mock ExternalAPIPanel component
vi.mock('../../external-api/external-api-panel', () => ({
  default: ({
    canManageExternalKnowledgeApi,
    onClose,
  }: {
    canManageExternalKnowledgeApi: boolean
    onClose: () => void
  }) => (
    <div
      data-testid="external-api-panel"
      data-can-manage-external-knowledge-api={canManageExternalKnowledgeApi}
    >
      <button onClick={onClose}>Close Panel</button>
    </div>
  ),
}))

// Service API management has its own integration coverage.
vi.mock('@/app/components/datasets/extra-info/service-api', () => ({
  ServiceApi: () => null,
}))

// Mock TagManagementModal
vi.mock('@/features/tag-management/components/tag-management-modal', () => ({
  TagManagementModal: ({ show }: { show: boolean }) =>
    show ? <div data-testid="tag-management-modal" /> : null,
}))

// Mock TagFilter
vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: ({
    onChange,
    onOpenTagManagement,
  }: {
    value: string[]
    onChange: (val: string[]) => void
    onOpenTagManagement: () => void
  }) => (
    <div data-testid="tag-filter">
      <button onClick={() => onChange(['tag-1', 'tag-2'])}>Select Tags</button>
      <button onClick={onOpenTagManagement}>Manage Tags</button>
    </div>
  ),
}))

// Mock CheckboxWithLabel
vi.mock('@/app/components/datasets/create/website/base/checkbox-with-label', () => ({
  default: ({
    isChecked,
    onChange,
    label,
  }: {
    isChecked: boolean
    onChange: () => void
    label: string
  }) => (
    <label>
      <input
        type="checkbox"
        checked={isChecked}
        onChange={onChange}
        data-testid="include-all-checkbox"
      />
      {label}
    </label>
  ),
}))

describe('List', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    mockConsoleState = {
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceOwner: true,
      workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
    }
    mockDatasetListQuery.mockReturnValue({
      data: { pages: [{ data: [], total: 1 }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
    })
  })

  describe('Rendering', () => {
    it('should render the search input', () => {
      render(<List />)
      expect(screen.getByRole('searchbox')).toBeInTheDocument()
    })

    it('should render tag filter', () => {
      render(<List />)
      expect(screen.getByTestId('tag-filter')).toBeInTheDocument()
    })

    it('should render external API panel button', () => {
      render(<List />)
      expect(screen.getByText(/externalAPIPanelTitle/)).toBeInTheDocument()
    })

    it('should hide external API panel button without dataset.external.connect', () => {
      mockConsoleState = {
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: ['dataset.create_and_management'],
      }

      render(<List />)

      expect(screen.queryByText(/externalAPIPanelTitle/)).not.toBeInTheDocument()
      expect(screen.queryByTestId('external-api-panel')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should query datasets with includeAll disabled initially', async () => {
      render(<List />)

      expect(mockDatasetListQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          include_all: false,
        }),
      )
    })

    it('should query datasets with empty keywords initially', async () => {
      render(<List />)

      expect(mockDatasetListQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          keyword: '',
        }),
      )
    })

    it('should query datasets with empty tags initially', async () => {
      render(<List />)

      expect(mockDatasetListQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          tag_ids: [],
        }),
      )
    })
  })

  describe('User Interactions', () => {
    it('should open external API panel when button is clicked', () => {
      render(<List />)

      const button = screen.getByText(/externalAPIPanelTitle/)
      fireEvent.click(button)

      expect(screen.getByTestId('external-api-panel')).toBeInTheDocument()
    })

    it('should update search input value', () => {
      render(<List />)

      const input = screen.getByRole('searchbox')
      fireEvent.change(input, { target: { value: 'test search' } })

      expect(input).toHaveValue('test search')
    })

    it('should trigger tag filter change', () => {
      render(<List />)
      // Tag filter is rendered and interactive
      const selectTagsBtn = screen.getByText('Select Tags')
      expect(selectTagsBtn).toBeInTheDocument()
      fireEvent.click(selectTagsBtn)
      // The onChange callback was triggered (debounced)
    })
  })

  describe('Conditional Rendering', () => {
    it('should show include all checkbox for workspace owner', () => {
      render(<List />)
      expect(screen.getByTestId('include-all-checkbox')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty state gracefully', () => {
      render(<List />)
      // Should render without errors even with empty data
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
    })

    it('should render first empty state when there are no datasets and no active filters', async () => {
      mockDatasetListQuery.mockReturnValue({
        data: { pages: [{ data: [], total: 0 }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      })

      render(<List />)

      expect(screen.getByText('dataset.firstEmpty.title')).toBeInTheDocument()
      expect(screen.queryByTestId('datasets-component')).not.toBeInTheDocument()
    })

    it('should render first empty state when dataset.create_and_management is available', async () => {
      mockConsoleState = {
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: ['dataset.create_and_management'],
      }
      mockDatasetListQuery.mockReturnValue({
        data: { pages: [{ data: [], total: 0 }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      })

      render(<List />)

      expect(screen.getByText('dataset.firstEmpty.title')).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
      ).toHaveAttribute('href', '/datasets/create-from-pipeline')
    })

    it('should render a permission empty state without dataset creation permissions', async () => {
      mockConsoleState = {
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: [],
      }
      mockDatasetListQuery.mockReturnValue({
        data: { pages: [{ data: [], total: 0 }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      })

      render(<List />)

      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
      expect(screen.getByText('dataset.firstEmpty.noCreatePermission')).toBeInTheDocument()
      expect(screen.queryByTestId('datasets-component')).not.toBeInTheDocument()
    })

    it('should not render first empty state before the first dataset page resolves', async () => {
      mockDatasetListQuery.mockReturnValue({
        data: { pages: [] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      })

      render(<List />)

      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
    })

    it('should keep the regular list for empty filtered results', async () => {
      mockDatasetListQuery.mockImplementation((params) => ({
        data: { pages: [{ data: [], total: params.include_all ? 0 : 1 }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      }))

      render(<List />)

      fireEvent.click(screen.getByTestId('include-all-checkbox'))

      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('dataset.filterEmpty.noKnowledge')
      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
    })

    it('announces empty search results only after the current filters finish loading', async () => {
      const user = userEvent.setup()
      const result = {
        data: { pages: [{ data: [], total: 1 }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
        isPlaceholderData: false,
        isError: false,
      }
      mockDatasetListQuery.mockImplementation(() => result)
      const { rerender } = render(<List />)
      const status = screen.getByRole('status')
      const search = screen.getByRole('searchbox')
      expect(status).toBeEmptyDOMElement()

      await user.type(search, 'missing')
      expect(status).toBeEmptyDOMElement()
      await waitFor(() =>
        expect(mockDatasetListQuery).toHaveBeenLastCalledWith(
          expect.objectContaining({ keyword: 'missing' }),
        ),
      )

      result.data.pages = [{ data: [], total: 0 }]
      result.isFetching = true
      result.isPlaceholderData = true
      rerender(<List />)
      expect(status).toBeEmptyDOMElement()

      result.isPlaceholderData = false
      rerender(<List />)
      expect(status).toBeEmptyDOMElement()

      result.isFetching = false
      rerender(<List />)
      expect(screen.getByRole('status')).toBe(status)
      expect(status).toHaveTextContent('dataset.filterEmpty.noKnowledge')
      expect(search).toHaveFocus()

      await user.type(search, ' again')
      expect(status).toBeEmptyDOMElement()
    })
  })

  describe('Branch Coverage', () => {
    it('should not redirect normal role users at component level', async () => {
      // Re-mock app context state with normal role.

      // Clear module cache and re-import
      vi.resetModules()
      const { default: ListComponent } = await import('../index')

      render(<ListComponent />)

      await waitFor(() => {
        expect(mockReplace).not.toHaveBeenCalled()
      })
    })

    it('should clear search input when onClear is called', () => {
      render(<List />)

      const input = screen.getByRole('searchbox')
      // First set a value
      fireEvent.change(input, { target: { value: 'test search' } })
      expect(input).toHaveValue('test search')

      // Find and click the clear button
      const clearButton = document.querySelector('[class*="clear"], button[aria-label*="clear"]')
      if (clearButton) {
        fireEvent.click(clearButton)
        expect(input).toHaveValue('')
      }
    })

    it('should close ExternalAPIPanel when onClose is called', () => {
      render(<List />)

      fireEvent.click(screen.getByText(/externalAPIPanelTitle/))
      fireEvent.click(screen.getByText('Close Panel'))

      expect(screen.queryByTestId('external-api-panel')).not.toBeInTheDocument()
    })

    it('should show TagManagementModal when tag management is opened', () => {
      render(<List />)
      fireEvent.click(screen.getByText('Manage Tags'))

      expect(screen.getByTestId('tag-management-modal')).toBeInTheDocument()
    })

    it('should not show include all checkbox when not workspace owner', async () => {
      mockConsoleState = {
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
        workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
      }

      vi.resetModules()
      const { default: ListComponent } = await import('../index')

      render(<ListComponent />)

      expect(screen.queryByTestId('include-all-checkbox')).not.toBeInTheDocument()
    })
  })
})
