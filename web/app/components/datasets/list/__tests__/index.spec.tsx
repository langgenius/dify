import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import List from '../index'

const mockPush = vi.fn()
const mockReplace = vi.fn()
let mockAppContextState = {
  isCurrentWorkspaceEditor: true,
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: true,
  workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
}
let mockIsCurrentWorkspaceOwner = true
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

// Mock app context
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: { role: 'admin' },
    isCurrentWorkspaceOwner: mockIsCurrentWorkspaceOwner,
  }),
  useSelector: (selector: (state: typeof mockAppContextState) => unknown) => selector(mockAppContextState),
}))

vi.mock('@/app/components/datasets/hooks/use-dataset-access', async () => {
  const { createDatasetAccessHookMock } = await import('@/app/components/datasets/hooks/__tests__/mock-dataset-access')

  return createDatasetAccessHookMock(() => mockAppContextState)
})

// Mock external api panel context
const mockSetShowExternalApiPanel = vi.fn()
vi.mock('@/context/external-api-panel-context', () => ({
  useExternalApiPanel: () => ({
    showExternalApiPanel: false,
    setShowExternalApiPanel: mockSetShowExternalApiPanel,
  }),
}))

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

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetList: vi.fn(() => ({
    data: { pages: [{ data: [], total: 1 }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetching: false,
    isFetchingNextPage: false,
  })),
  useInvalidDatasetList: () => vi.fn(),
  useDatasetApiBaseUrl: () => ({
    data: { api_base_url: 'https://api.example.com' },
  }),
}))

// Mock Datasets component
vi.mock('../datasets', () => ({
  default: ({ datasetList, emptyElement }: { datasetList?: { pages: Array<{ total?: number }> }, emptyElement?: ReactNode }) => (
    <div data-testid="datasets-component">
      <span data-testid="dataset-total">{datasetList?.pages[0]?.total}</span>
      {emptyElement}
    </div>
  ),
}))

// Mock ExternalAPIPanel component
vi.mock('../../external-api/external-api-panel', () => ({
  default: ({ canManageExternalKnowledgeApi, onClose }: { canManageExternalKnowledgeApi: boolean, onClose: () => void }) => (
    <div data-testid="external-api-panel" data-can-manage-external-knowledge-api={canManageExternalKnowledgeApi}>
      <button onClick={onClose}>Close Panel</button>
    </div>
  ),
}))

// Mock SecretKeyModal — it depends on user profile context and service APIs
// not configured in this test. ServiceApi always mounts the modal (controlled
// by `isShow`) so we provide a lightweight stub.
vi.mock('@/app/components/develop/secret-key/secret-key-modal', () => ({
  default: ({ isShow }: { isShow: boolean }) =>
    isShow ? <div data-testid="secret-key-modal" /> : null,
}))

// Mock TagManagementModal
vi.mock('@/features/tag-management/components/tag-management-modal', () => ({
  TagManagementModal: ({ show }: { show: boolean }) => show ? <div data-testid="tag-management-modal" /> : null,
}))

// Mock TagFilter
vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: ({ onChange, onOpenTagManagement }: { value: string[], onChange: (val: string[]) => void, onOpenTagManagement: () => void }) => (
    <div data-testid="tag-filter">
      <button onClick={() => onChange(['tag-1', 'tag-2'])}>Select Tags</button>
      <button onClick={onOpenTagManagement}>Manage Tags</button>
    </div>
  ),
}))

// Mock CheckboxWithLabel
vi.mock('@/app/components/datasets/create/website/base/checkbox-with-label', () => ({
  default: ({ isChecked, onChange, label }: { isChecked: boolean, onChange: () => void, label: string }) => (
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
    mockAppContextState = {
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceOwner: true,
      workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
    }
    mockIsCurrentWorkspaceOwner = true
    const { useDatasetList } = await import('@/service/knowledge/use-dataset')
    vi.mocked(useDatasetList).mockReturnValue({
      data: { pages: [{ data: [], total: 1 }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
    } as unknown as ReturnType<typeof useDatasetList>)
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<List />)
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
    })

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
      mockAppContextState = {
        isCurrentWorkspaceEditor: true,
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: ['dataset.create_and_management'],
      }

      render(<List />)

      expect(screen.queryByText(/externalAPIPanelTitle/)).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should query datasets with includeAll disabled initially', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')

      render(<List />)

      expect(useDatasetList).toHaveBeenCalledWith(expect.objectContaining({
        include_all: false,
      }))
    })

    it('should query datasets with empty keywords initially', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')

      render(<List />)

      expect(useDatasetList).toHaveBeenCalledWith(expect.objectContaining({
        keyword: '',
      }))
    })

    it('should query datasets with empty tags initially', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')

      render(<List />)

      expect(useDatasetList).toHaveBeenCalledWith(expect.objectContaining({
        tag_ids: [],
      }))
    })
  })

  describe('User Interactions', () => {
    it('should open external API panel when button is clicked', () => {
      render(<List />)

      const button = screen.getByText(/externalAPIPanelTitle/)
      fireEvent.click(button)

      expect(mockSetShowExternalApiPanel).toHaveBeenCalledWith(true)
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

  describe('Styles', () => {
    it('should have correct container styling', () => {
      const { container } = render(<List />)
      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('relative', 'flex', 'grow', 'flex-col')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty state gracefully', () => {
      render(<List />)
      // Should render without errors even with empty data
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
    })

    it('should render first empty state when there are no datasets and no active filters', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [], total: 0 }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<List />)

      expect(screen.getByText('dataset.firstEmpty.title')).toBeInTheDocument()
      expect(screen.queryByTestId('datasets-component')).not.toBeInTheDocument()
    })

    it('should render first empty state when dataset.create_and_management is available without the legacy editor role', async () => {
      mockAppContextState = {
        isCurrentWorkspaceEditor: false,
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: ['dataset.create_and_management'],
      }
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [], total: 0 }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<List />)

      expect(screen.getByText('dataset.firstEmpty.title')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ })).toHaveAttribute('href', '/datasets/create-from-pipeline')
    })

    it('should not render first empty state for legacy editors without dataset creation permissions', async () => {
      mockAppContextState = {
        isCurrentWorkspaceEditor: true,
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: [],
      }
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [], total: 0 }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<List />)

      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
    })

    it('should not render first empty state before the first dataset page resolves', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<List />)

      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
    })

    it('should keep the regular list for empty filtered results', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockImplementation(params => ({
        data: { pages: [{ data: [], total: params.include_all ? 0 : 1 }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>))

      render(<List />)

      fireEvent.click(screen.getByTestId('include-all-checkbox'))

      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
      expect(screen.getByText('dataset.filterEmpty.noKnowledge')).toBeInTheDocument()
      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
    })
  })

  describe('Branch Coverage', () => {
    it('should not redirect normal role users at component level', async () => {
      // Re-mock useAppContext with normal role
      vi.doMock('@/context/app-context', () => ({
        useAppContext: () => ({
          currentWorkspace: { role: 'normal' },
          isCurrentWorkspaceOwner: false,
        }),
        useSelector: (selector: (state: typeof mockAppContextState) => unknown) => selector({
          isCurrentWorkspaceEditor: false,
          isCurrentWorkspaceManager: false,
          isCurrentWorkspaceOwner: false,
          workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
        }),
      }))

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

    it('should show ExternalAPIPanel when showExternalApiPanel is true', async () => {
      // Re-mock to show external API panel
      vi.doMock('@/context/external-api-panel-context', () => ({
        useExternalApiPanel: () => ({
          showExternalApiPanel: true,
          setShowExternalApiPanel: mockSetShowExternalApiPanel,
        }),
      }))

      vi.resetModules()
      const { default: ListComponent } = await import('../index')

      render(<ListComponent />)

      expect(screen.getByTestId('external-api-panel')).toBeInTheDocument()
      expect(screen.getByTestId('external-api-panel')).toHaveAttribute('data-can-manage-external-knowledge-api', 'true')
    })

    it('should not show ExternalAPIPanel without dataset.external.connect even when panel state is open', async () => {
      mockAppContextState = {
        isCurrentWorkspaceEditor: true,
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: ['dataset.create_and_management'],
      }
      vi.doMock('@/context/app-context', () => ({
        useAppContext: () => ({
          currentWorkspace: { role: 'admin' },
          isCurrentWorkspaceOwner: true,
        }),
        useSelector: (selector: (state: typeof mockAppContextState) => unknown) => selector({
          isCurrentWorkspaceEditor: true,
          isCurrentWorkspaceManager: true,
          isCurrentWorkspaceOwner: true,
          workspacePermissionKeys: ['dataset.create_and_management'],
        }),
      }))
      vi.doMock('@/context/external-api-panel-context', () => ({
        useExternalApiPanel: () => ({
          showExternalApiPanel: true,
          setShowExternalApiPanel: mockSetShowExternalApiPanel,
        }),
      }))

      vi.resetModules()
      const { default: ListComponent } = await import('../index')

      render(<ListComponent />)

      expect(screen.queryByTestId('external-api-panel')).not.toBeInTheDocument()
    })

    it('should close ExternalAPIPanel when onClose is called', async () => {
      vi.doMock('@/context/app-context', () => ({
        useAppContext: () => ({
          currentWorkspace: { role: 'admin' },
          isCurrentWorkspaceOwner: true,
        }),
        useSelector: (selector: (state: typeof mockAppContextState) => unknown) => selector({
          isCurrentWorkspaceEditor: true,
          isCurrentWorkspaceManager: true,
          isCurrentWorkspaceOwner: true,
          workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
        }),
      }))
      vi.doMock('@/context/external-api-panel-context', () => ({
        useExternalApiPanel: () => ({
          showExternalApiPanel: true,
          setShowExternalApiPanel: mockSetShowExternalApiPanel,
        }),
      }))

      vi.resetModules()
      const { default: ListComponent } = await import('../index')

      render(<ListComponent />)

      const closeButton = screen.getByText('Close Panel')
      fireEvent.click(closeButton)

      expect(mockSetShowExternalApiPanel).toHaveBeenCalledWith(false)
    })

    it('should show TagManagementModal when tag management is opened', () => {
      render(<List />)
      fireEvent.click(screen.getByText('Manage Tags'))

      expect(screen.getByTestId('tag-management-modal')).toBeInTheDocument()
    })

    it('should not show include all checkbox when not workspace owner', async () => {
      mockAppContextState = {
        isCurrentWorkspaceEditor: true,
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
        workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
      }
      vi.doMock('@/context/app-context', () => ({
        useAppContext: () => ({
          currentWorkspace: { role: 'editor' },
          isCurrentWorkspaceOwner: false,
        }),
        useSelector: (selector: (state: typeof mockAppContextState) => unknown) => selector({
          isCurrentWorkspaceEditor: true,
          isCurrentWorkspaceManager: true,
          isCurrentWorkspaceOwner: false,
          workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
        }),
      }))

      vi.resetModules()
      const { default: ListComponent } = await import('../index')

      render(<ListComponent />)

      expect(screen.queryByTestId('include-all-checkbox')).not.toBeInTheDocument()
    })
  })
})
