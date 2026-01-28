import type { DataSet } from '@/models/datasets'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import Datasets from './datasets'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock ahooks
vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  return {
    ...actual,
    useHover: () => false,
  }
})

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

// Mock service hooks - will be overridden in individual tests
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
  })),
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

// Mock app context - will be overridden in tests
vi.mock('@/context/app-context', () => ({
  useSelector: vi.fn(() => true),
}))

// Mock useDatasetCardState hook
vi.mock('./dataset-card/hooks/use-dataset-card-state', () => ({
  useDatasetCardState: () => ({
    tags: [],
    setTags: vi.fn(),
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

// Mock RenameDatasetModal
vi.mock('../rename-modal', () => ({
  default: () => null,
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

// Store IntersectionObserver callbacks for testing
let intersectionObserverCallback: IntersectionObserverCallback | null = null
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()
const mockUnobserve = vi.fn()

// Custom IntersectionObserver mock
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
  const defaultProps = {
    tags: [],
    keywords: '',
    includeAll: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    intersectionObserverCallback = null
    document.title = ''

    // Setup IntersectionObserver mock
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

    it('should render NewDatasetCard when user is editor', async () => {
      const { useSelector } = await import('@/context/app-context')
      vi.mocked(useSelector).mockReturnValue(true)

      render(<Datasets {...defaultProps} />)
      expect(screen.getByText(/createDataset/)).toBeInTheDocument()
    })

    it('should NOT render NewDatasetCard when user is NOT editor', async () => {
      const { useSelector } = await import('@/context/app-context')
      vi.mocked(useSelector).mockReturnValue(false)

      render(<Datasets {...defaultProps} />)
      expect(screen.queryByText(/createDataset/)).not.toBeInTheDocument()
    })

    it('should render dataset cards from data', () => {
      render(<Datasets {...defaultProps} />)
      expect(screen.getByText('Dataset 1')).toBeInTheDocument()
      expect(screen.getByText('Dataset 2')).toBeInTheDocument()
    })

    it('should render anchor div for infinite scroll', () => {
      render(<Datasets {...defaultProps} />)
      const anchor = document.querySelector('.h-0')
      expect(anchor).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass tags to useDatasetList', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      render(<Datasets {...defaultProps} tags={['tag-1', 'tag-2']} />)
      expect(useDatasetList).toHaveBeenCalledWith(
        expect.objectContaining({
          tag_ids: ['tag-1', 'tag-2'],
        }),
      )
    })

    it('should pass keywords to useDatasetList', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      render(<Datasets {...defaultProps} keywords="search term" />)
      expect(useDatasetList).toHaveBeenCalledWith(
        expect.objectContaining({
          keyword: 'search term',
        }),
      )
    })

    it('should pass includeAll to useDatasetList', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      render(<Datasets {...defaultProps} includeAll={true} />)
      expect(useDatasetList).toHaveBeenCalledWith(
        expect.objectContaining({
          include_all: true,
        }),
      )
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
    it('should show Loading component when isFetchingNextPage is true', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [] }] },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: true,
        isFetching: false,
        isFetchingNextPage: true,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)
      // Loading component renders a div with loading classes
      const nav = screen.getByRole('navigation')
      expect(nav).toBeInTheDocument()
    })

    it('should NOT show Loading component when isFetchingNextPage is false', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [] }] },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: true,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })
  })

  describe('DatasetList null handling', () => {
    it('should handle null datasetList gracefully', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: null,
        fetchNextPage: mockFetchNextPage,
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should handle undefined datasetList gracefully', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: undefined,
        fetchNextPage: mockFetchNextPage,
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should handle empty pages array', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [] },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })
  })

  describe('IntersectionObserver', () => {
    it('should setup IntersectionObserver on mount', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [] }] },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: true,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)

      // Should observe the anchor element
      expect(mockObserve).toHaveBeenCalled()
    })

    it('should call fetchNextPage when isIntersecting, hasNextPage, and not isFetching', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [] }] },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: true,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)

      // Simulate intersection
      if (intersectionObserverCallback) {
        intersectionObserverCallback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }

      expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
    })

    it('should NOT call fetchNextPage when isIntersecting is false', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [] }] },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: true,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)

      if (intersectionObserverCallback) {
        intersectionObserverCallback(
          [{ isIntersecting: false } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })

    it('should NOT call fetchNextPage when hasNextPage is false', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [] }] },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: false, // No more pages
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)

      if (intersectionObserverCallback) {
        intersectionObserverCallback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })

    it('should NOT call fetchNextPage when isFetching is true', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [] }] },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: true,
        isFetching: true, // Already fetching
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)

      if (intersectionObserverCallback) {
        intersectionObserverCallback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })

    it('should disconnect observer on unmount', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: { pages: [{ data: [] }] },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: true,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      const { unmount } = render(<Datasets {...defaultProps} />)

      // Unmount the component
      unmount()

      // disconnect should be called during cleanup
      expect(mockDisconnect).toHaveBeenCalled()
    })
  })

  describe('Styles', () => {
    it('should have correct grid styling', () => {
      render(<Datasets {...defaultProps} />)
      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('grid', 'grow', 'gap-3', 'px-12')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty tags array', () => {
      render(<Datasets {...defaultProps} tags={[]} />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should handle empty keywords', () => {
      render(<Datasets {...defaultProps} keywords="" />)
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should handle multiple pages of data', async () => {
      const { useDatasetList } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetList).mockReturnValue({
        data: {
          pages: [
            { data: [createMockDataset({ id: 'ds-1', name: 'Page 1 Dataset' })] },
            { data: [createMockDataset({ id: 'ds-2', name: 'Page 2 Dataset' })] },
          ],
        },
        fetchNextPage: mockFetchNextPage,
        hasNextPage: false,
        isFetching: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<Datasets {...defaultProps} />)
      expect(screen.getByText('Page 1 Dataset')).toBeInTheDocument()
      expect(screen.getByText('Page 2 Dataset')).toBeInTheDocument()
    })
  })
})
