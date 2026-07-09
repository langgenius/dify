import type { DataSet, DataSetListResponse } from '@/models/datasets'
import type { useDatasetList } from '@/service/knowledge/use-dataset'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import Datasets from '../datasets'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (timestamp: number) => new Date(timestamp).toLocaleDateString(),
  }),
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'High Quality',
  }),
}))

const mockFetchNextPage = vi.fn()
const mockInvalidDatasetList = vi.fn()

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetList: vi.fn(() => ({
    data: {
      pages: [
        {
          data: [
            createMockDataset({ id: 'dataset-1', name: 'Dataset 1' }),
            createMockDataset({ id: 'dataset-2', name: 'Dataset 2' }),
          ],
        },
      ],
    },
    fetchNextPage: mockFetchNextPage,
    hasNextPage: false,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
    isPlaceholderData: false,
  })),
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

vi.mock('../dataset-card/hooks/use-dataset-card-state', () => ({
  useDatasetCardState: () => ({
    modalState: {
      showRenameModal: false,
      showConfirmDelete: false,
      confirmMessage: '',
    },
    openRenameModal: vi.fn(),
    closeRenameModal: vi.fn(),
    closeConfirmDelete: vi.fn(),
    handleExportPipeline: vi.fn(),
    detectIsUsedByApp: vi.fn(),
    onConfirmDelete: vi.fn(),
  }),
}))

vi.mock('../../rename-modal', () => ({
  default: () => null,
}))

vi.mock('../dataset-card', () => ({
  default: ({ dataset }: { dataset: DataSet }) => (
    <article data-testid={`dataset-card-${dataset.id}`}>
      {dataset.name}
    </article>
  ),
}))

function createMockDataset(overrides: Partial<DataSet> = {}): DataSet {
  return {
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    provider: 'vendor',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    embedding_available: true,
    app_count: 5,
    document_count: 10,
    word_count: 1000,
    created_at: 1609459200,
    updated_at: 1609545600,
    tags: [],
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    created_by: 'user-1',
    doc_form: ChunkingMode.text,
    runtime_mode: 'general',
    is_published: true,
    total_available_documents: 10,
    icon_info: {
      icon: '📙',
      icon_type: 'emoji' as const,
      icon_background: '#FFF4ED',
      icon_url: '',
    },
    retrieval_model_dict: {
      search_method: RETRIEVE_METHOD.semantic,
    },
    author_name: 'Test User',
    ...overrides,
  } as DataSet
}

let intersectionObserverCallback: IntersectionObserverCallback | null = null
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()
const mockUnobserve = vi.fn()

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersectionObserverCallback = callback
  }

  observe = mockObserve
  disconnect = mockDisconnect
  unobserve = mockUnobserve
  root = null
  rootMargin = ''
  thresholds = []
  takeRecords = () => []
}

describe('Datasets', () => {
  const createDatasetListData = (
    pages: Array<Pick<DataSetListResponse, 'data'> & Partial<Omit<DataSetListResponse, 'data'>>> = [
      {
        data: [
          createMockDataset({ id: 'dataset-1', name: 'Dataset 1' }),
          createMockDataset({ id: 'dataset-2', name: 'Dataset 2' }),
        ],
      },
    ],
  ) => ({
    pages: pages.map((page, index) => ({
      has_more: false,
      limit: page.data.length,
      page: index + 1,
      total: page.data.length,
      ...page,
    })),
    pageParams: pages.map((_, index) => index + 1),
  }) as unknown as ReturnType<typeof useDatasetList>['data']

  const defaultProps = {
    datasetList: createDatasetListData(),
    fetchNextPage: mockFetchNextPage,
    hasNextPage: false,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
    isPlaceholderData: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    intersectionObserverCallback = null
    document.title = ''
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Datasets {...defaultProps} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should not render NewDatasetCard in dataset list', () => {
      render(<Datasets {...defaultProps} />)

      expect(screen.queryByText(/createDataset/)).not.toBeInTheDocument()
    })

    it('should render dataset cards from data', () => {
      render(<Datasets {...defaultProps} />)
      expect(screen.getByText('Dataset 1')).toBeInTheDocument()
      expect(screen.getByText('Dataset 2')).toBeInTheDocument()
    })

    it('should render empty element when there are no datasets', () => {
      render(
        <Datasets
          {...defaultProps}
          datasetList={createDatasetListData([{ data: [], total: 0 }])}
          emptyElement={<div data-testid="filtered-empty">No knowledge here</div>}
        />,
      )

      expect(screen.getByTestId('filtered-empty')).toBeInTheDocument()
    })

    it('should render anchor div for infinite scroll', () => {
      render(<Datasets {...defaultProps} />)
      const anchor = document.querySelector('.h-0')
      expect(anchor).toBeInTheDocument()
    })
  })

  describe('Document Title', () => {
    it('should set document title on mount', async () => {
      render(<Datasets {...defaultProps} />)
      await waitFor(() => {
        expect(document.title).toContain('dataset.knowledge')
      })
    })
  })

  describe('Loading States', () => {
    it('should show dataset card skeletons while initial dataset list is loading', () => {
      render(
        <Datasets
          {...defaultProps}
          datasetList={undefined}
          isFetching={true}
          isLoading={true}
        />,
      )

      expect(screen.getByRole('status', { name: /common\.loading/ })).toBeInTheDocument()
      expect(screen.queryByText('Dataset 1')).not.toBeInTheDocument()
    })

    it('should not show dataset card skeletons after an empty dataset list has loaded', () => {
      render(
        <Datasets
          {...defaultProps}
          datasetList={createDatasetListData([{ data: [] }])}
          emptyElement={<div data-testid="filtered-empty">No knowledge here</div>}
        />,
      )

      expect(screen.queryByRole('status', { name: /common\.loading/ })).not.toBeInTheDocument()
      expect(screen.getByTestId('filtered-empty')).toBeInTheDocument()
    })

    it('should show dataset card skeletons when placeholder data is empty and the next query is fetching', () => {
      render(
        <Datasets
          {...defaultProps}
          datasetList={createDatasetListData([{ data: [] }])}
          isFetching={true}
          isPlaceholderData={true}
        />,
      )

      expect(screen.getByRole('status', { name: /common\.loading/ })).toBeInTheDocument()
    })

    it('should keep rendered dataset cards when placeholder data has results during refetch', () => {
      render(
        <Datasets
          {...defaultProps}
          datasetList={createDatasetListData([{ data: [createMockDataset({ id: 'dataset-1', name: 'Dataset 1' })] }])}
          isFetching={true}
          isPlaceholderData={true}
        />,
      )

      expect(screen.queryByRole('status', { name: /common\.loading/ })).not.toBeInTheDocument()
      expect(screen.getByText('Dataset 1')).toBeInTheDocument()
    })

    it('should show Loading component when isFetchingNextPage is true', () => {
      render(<Datasets {...defaultProps} hasNextPage={true} isFetchingNextPage={true} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should NOT show Loading component when isFetchingNextPage is false', () => {
      render(<Datasets {...defaultProps} hasNextPage={true} isFetchingNextPage={false} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })
  })

  describe('DatasetList null handling', () => {
    it('should handle null datasetList gracefully', () => {
      render(<Datasets {...defaultProps} datasetList={null} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should handle undefined datasetList gracefully', () => {
      render(<Datasets {...defaultProps} datasetList={undefined} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should handle empty pages array', () => {
      render(<Datasets {...defaultProps} datasetList={createDatasetListData([])} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })
  })

  describe('IntersectionObserver', () => {
    it('should setup IntersectionObserver on mount', () => {
      render(<Datasets {...defaultProps} hasNextPage={true} />)

      expect(mockObserve).toHaveBeenCalled()
    })

    it('should call fetchNextPage when isIntersecting, hasNextPage, and not isFetching', () => {
      render(<Datasets {...defaultProps} hasNextPage={true} />)

      if (intersectionObserverCallback) {
        intersectionObserverCallback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }

      expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
    })

    it('should NOT call fetchNextPage when isIntersecting is false', () => {
      render(<Datasets {...defaultProps} hasNextPage={true} />)

      if (intersectionObserverCallback) {
        intersectionObserverCallback(
          [{ isIntersecting: false } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })

    it('should NOT call fetchNextPage when hasNextPage is false', () => {
      render(<Datasets {...defaultProps} />)

      if (intersectionObserverCallback) {
        intersectionObserverCallback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })

    it('should NOT call fetchNextPage when isFetching is true', () => {
      render(<Datasets {...defaultProps} hasNextPage={true} isFetching={true} />)

      if (intersectionObserverCallback) {
        intersectionObserverCallback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })

    it('should NOT call fetchNextPage when placeholder data is showing', () => {
      render(<Datasets {...defaultProps} hasNextPage={true} isPlaceholderData={true} />)

      if (intersectionObserverCallback) {
        intersectionObserverCallback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })

    it('should disconnect observer on unmount', () => {
      const { unmount } = render(<Datasets {...defaultProps} hasNextPage={true} />)

      unmount()

      expect(mockDisconnect).toHaveBeenCalled()
    })
  })

  describe('Styles', () => {
    it('should have correct grid styling', () => {
      render(<Datasets {...defaultProps} />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('relative', 'grid', 'grow', 'grid-cols-[repeat(auto-fill,minmax(296px,1fr))]', 'content-start', 'gap-3', 'px-8', 'pt-2')
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple pages of data', () => {
      render(
        <Datasets
          {...defaultProps}
          datasetList={createDatasetListData([
            { data: [createMockDataset({ id: 'ds-1', name: 'Page 1 Dataset' })] },
            { data: [createMockDataset({ id: 'ds-2', name: 'Page 2 Dataset' })] },
          ])}
        />,
      )
      expect(screen.getByText('Page 1 Dataset')).toBeInTheDocument()
      expect(screen.getByText('Page 2 Dataset')).toBeInTheDocument()
    })
  })
})
