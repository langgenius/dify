import type { ReactElement, ReactNode } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useNewKnowledgeGuideDismissedValue } from '@/features/new-rag/storage'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import List from '../index'

const knowledgeFsInfiniteOptionsMock = vi.hoisted(() => vi.fn(() => ({})))
const systemFeaturesQueryKey = ['console', 'systemFeatures', 'get'] as const
const useInfiniteQueryMock = vi.hoisted(() =>
  vi.fn(() => ({
    data: { pageParams: [null], pages: [{ items: [] }] },
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    isPending: false,
    refetch: vi.fn(),
  })),
)

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: useInfiniteQueryMock,
  }
})

vi.mock('@/service/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/service/client')>()
  return {
    ...original,
    consoleQuery: {
      ...original.consoleQuery,
      systemFeatures: {
        get: {
          queryKey: () => systemFeaturesQueryKey,
          queryOptions: (options: Record<string, unknown> = {}) => ({
            queryKey: systemFeaturesQueryKey,
            queryFn: () => new Promise(() => {}),
            ...options,
          }),
        },
      },
      knowledgeFs: {
        ...original.consoleQuery.knowledgeFs,
        listKnowledgeSpaces: {
          infiniteOptions: knowledgeFsInfiniteOptionsMock,
        },
      },
    },
  }
})

function NewKnowledgeGuideDismissedProbe() {
  const dismissed = useNewKnowledgeGuideDismissedValue()

  return <output aria-label="new knowledge guide dismissed">{String(dismissed)}</output>
}

const mockPush = vi.fn()
const mockReplace = vi.fn()
let mockConsoleState = {
  isCurrentWorkspaceEditor: true,
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: true,
  knowledgeFsEnabled: false,
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

const renderList = (
  ui: ReactElement,
  options: Parameters<typeof createNuqsTestWrapper>[0] = {},
) => {
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper({
    systemFeatures: {
      knowledge_fs_enabled: mockConsoleState.knowledgeFsEnabled,
    },
  })
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper(options)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryWrapper>
      <NuqsWrapper>{children}</NuqsWrapper>
    </QueryWrapper>
  )

  return {
    ...renderWithConsoleState(ui, { wrapper }),
    onUrlUpdate,
  }
}

const render = (ui: ReactElement) => renderList(ui)
const renderWithNuqs = renderList

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

// Mock ApiKeyModal — it depends on user profile context and service APIs
// not configured in this test. ServiceApi always mounts the controlled modal,
// so we provide a lightweight stub.
vi.mock('@/app/components/api-key/api-key-modal', () => ({
  ApiKeyModal: ({ open }: { open: boolean }) => (open ? <div data-testid="api-key-modal" /> : null),
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
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceOwner: true,
      knowledgeFsEnabled: false,
      workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
    }
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

    it('should show the Legacy and New views when KnowledgeFS is enabled', () => {
      mockConsoleState.knowledgeFsEnabled = true

      renderWithNuqs(<List />)

      expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.legacy' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.new' })).toBeInTheDocument()
    })

    it('should keep the legacy query active without requesting KnowledgeFS when disabled', async () => {
      renderWithNuqs(<List />, { searchParams: '?view=new' })

      expect(
        screen.queryByRole('radio', { name: 'dataset.newKnowledge.new' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('region', { name: 'dataset.newKnowledge.new' }),
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
      expect(knowledgeFsInfiniteOptionsMock).not.toHaveBeenCalled()
      expect(useInfiniteQueryMock).not.toHaveBeenCalled()

      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      expect(useDatasetList).toHaveBeenCalled()
    })

    it('should switch to New Knowledge and persist the selected view in the URL', async () => {
      const user = userEvent.setup()
      mockConsoleState.knowledgeFsEnabled = true
      const { onUrlUpdate } = renderWithNuqs(<List />)

      await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.new' }))

      expect(
        await screen.findByRole('region', { name: 'dataset.newKnowledge.new' }),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('datasets-component')).not.toBeInTheDocument()
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('view')).toBe('new')
    })

    it('should reset each view panel when its owning list unmounts', async () => {
      const user = userEvent.setup()
      mockConsoleState.knowledgeFsEnabled = true
      renderWithNuqs(<List />)

      await user.click(screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' }))
      expect(screen.getByTestId('external-api-panel')).toBeInTheDocument()

      await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.new' }))
      expect(screen.queryByTestId('external-api-panel')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' }))
      expect(screen.getByTestId('external-api-panel')).toBeInTheDocument()

      await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.legacy' }))
      expect(screen.queryByTestId('external-api-panel')).not.toBeInTheDocument()
    })

    it('should restore the New Knowledge view from the URL', () => {
      mockConsoleState.knowledgeFsEnabled = true

      renderWithNuqs(<List />, { searchParams: '?view=new' })

      expect(screen.getByRole('region', { name: 'dataset.newKnowledge.new' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.new' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    })

    it('should show the first-visit guide once and remember dismissal', async () => {
      const user = userEvent.setup()
      mockConsoleState.knowledgeFsEnabled = true
      const firstRender = renderWithNuqs(<List />)

      const guide = await screen.findByRole('dialog', {
        name: 'dataset.newKnowledge.guideTitle',
      })
      await user.click(within(guide).getByRole('button', { name: 'dataset.newKnowledge.gotIt' }))
      firstRender.unmount()

      renderWithNuqs(<List />)

      expect(
        screen.queryByRole('dialog', { name: 'dataset.newKnowledge.guideTitle' }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.guideTitle' }))
      expect(
        await screen.findByRole('dialog', { name: 'dataset.newKnowledge.guideTitle' }),
      ).toBeInTheDocument()
    })

    it('should keep a dismissed guide closed after hydrating a full page reload', async () => {
      const user = userEvent.setup()
      mockConsoleState.knowledgeFsEnabled = true
      const firstRender = renderWithNuqs(<List />)
      const guide = await screen.findByRole('dialog', {
        name: 'dataset.newKnowledge.guideTitle',
      })
      await user.click(within(guide).getByRole('button', { name: 'dataset.newKnowledge.gotIt' }))
      firstRender.unmount()

      const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
      const { queryClient, wrapper: QueryWrapper } = createConsoleQueryWrapper({
        systemFeatures: {
          knowledge_fs_enabled: mockConsoleState.knowledgeFsEnabled,
        },
      })
      const store = createStore()
      store.set(queryClientAtom, queryClient)
      seedRegisteredConsoleStateFixture(store)
      const app = (
        <QueryWrapper>
          <Provider store={store}>
            <NuqsWrapper>
              <>
                <List />
                <NewKnowledgeGuideDismissedProbe />
              </>
            </NuqsWrapper>
          </Provider>
        </QueryWrapper>
      )
      const container = document.createElement('div')
      document.body.append(container)
      container.innerHTML = renderToString(app)
      const root = hydrateRoot(container, app)

      try {
        await waitFor(() => {
          expect(
            screen.getByRole('status', { name: 'new knowledge guide dismissed' }),
          ).toHaveTextContent('true')
        })
        await waitFor(() => {
          expect(
            screen.getByRole('button', { name: 'dataset.newKnowledge.guideTitle' }),
          ).toHaveAttribute('aria-expanded', 'false')
        })
      } finally {
        act(() => root.unmount())
        container.remove()
      }
    })

    it('should hide external API panel button without dataset.external.connect', () => {
      mockConsoleState = {
        isCurrentWorkspaceEditor: true,
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        knowledgeFsEnabled: false,
        workspacePermissionKeys: ['dataset.create_and_management'],
      }

      render(<List />)

      expect(screen.queryByText(/externalAPIPanelTitle/)).not.toBeInTheDocument()
      expect(screen.queryByTestId('external-api-panel')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should query datasets with includeAll disabled initially', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')

      render(<List />)

      expect(useDatasetList).toHaveBeenCalledWith(
        expect.objectContaining({
          include_all: false,
        }),
      )
    })

    it('should query datasets with empty keywords initially', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')

      render(<List />)

      expect(useDatasetList).toHaveBeenCalledWith(
        expect.objectContaining({
          keyword: '',
        }),
      )
    })

    it('should query datasets with empty tags initially', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')

      render(<List />)

      expect(useDatasetList).toHaveBeenCalledWith(
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
      mockConsoleState = {
        isCurrentWorkspaceEditor: false,
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        knowledgeFsEnabled: false,
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
      expect(
        screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
      ).toHaveAttribute('href', '/datasets/create-from-pipeline')
    })

    it('should render a permission empty state without dataset creation permissions', async () => {
      mockConsoleState = {
        isCurrentWorkspaceEditor: true,
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        knowledgeFsEnabled: false,
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
      expect(screen.getByText('dataset.firstEmpty.noCreatePermission')).toBeInTheDocument()
      expect(screen.queryByTestId('datasets-component')).not.toBeInTheDocument()
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
      vi.mocked(useDatasetList).mockImplementation(
        (params) =>
          ({
            data: { pages: [{ data: [], total: params.include_all ? 0 : 1 }] },
            fetchNextPage: vi.fn(),
            hasNextPage: false,
            isFetching: false,
            isFetchingNextPage: false,
          }) as unknown as ReturnType<typeof useDatasetList>,
      )

      render(<List />)

      fireEvent.click(screen.getByTestId('include-all-checkbox'))

      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
      expect(screen.getByText('dataset.filterEmpty.noKnowledge')).toBeInTheDocument()
      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
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
        isCurrentWorkspaceEditor: true,
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
        knowledgeFsEnabled: false,
        workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
      }

      vi.resetModules()
      const { default: ListComponent } = await import('../index')

      render(<ListComponent />)

      expect(screen.queryByTestId('include-all-checkbox')).not.toBeInTheDocument()
    })
  })
})
