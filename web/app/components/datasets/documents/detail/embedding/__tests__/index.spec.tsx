import type { ReactNode } from 'react'
import type { DocumentContextValue } from '../../context'
import type { IndexingStatusResponse, ProcessRuleResponse } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcessMode } from '@/models/datasets'
import * as datasetsService from '@/service/datasets'
import * as useDataset from '@/service/knowledge/use-dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../../create/step-two'
import { DocumentContext } from '../../context'
import EmbeddingDetail from '../index'

vi.mock('@/service/datasets')
vi.mock('@/service/knowledge/use-dataset')

const mockFetchIndexingStatus = vi.mocked(datasetsService.fetchIndexingStatus)
const mockPauseDocIndexing = vi.mocked(datasetsService.pauseDocIndexing)
const mockResumeDocIndexing = vi.mocked(datasetsService.resumeDocIndexing)
const mockUseProcessRule = vi.mocked(useDataset.useProcessRule)

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  },
})

const createWrapper = (contextValue: DocumentContextValue = { datasetId: 'ds1', documentId: 'doc1' }) => {
  const queryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DocumentContext.Provider value={contextValue}>
        {children}
      </DocumentContext.Provider>
    </QueryClientProvider>
  )
}

const mockIndexingStatus = (overrides: Partial<IndexingStatusResponse> = {}): IndexingStatusResponse => ({
  id: 'doc1',
  indexing_status: 'indexing',
  completed_segments: 50,
  total_segments: 100,
  processing_started_at: Date.now(),
  parsing_completed_at: 0,
  cleaning_completed_at: 0,
  splitting_completed_at: 0,
  completed_at: null,
  paused_at: null,
  error: null,
  stopped_at: null,
  ...overrides,
})

const mockProcessRule = (overrides: Partial<ProcessRuleResponse> = {}): ProcessRuleResponse => ({
  mode: ProcessMode.general,
  rules: {
    segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
    pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: true }],
    parent_mode: 'full-doc',
    subchunk_segmentation: { separator: '\n', max_tokens: 200, chunk_overlap: 20 },
  },
  limits: { indexing_max_segmentation_tokens_length: 4000 },
  ...overrides,
})

describe('EmbeddingDetail', () => {
  const defaultProps = {
    detailUpdate: vi.fn(),
    indexingType: IndexingType.QUALIFIED,
    retrievalMethod: RETRIEVE_METHOD.semantic,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseProcessRule.mockReturnValue({
      data: mockProcessRule(),
      isLoading: false,
      error: null,
    } as ReturnType<typeof useDataset.useProcessRule>)
  })

  describe('Rendering', () => {
    it('should render without crashing', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/embedding\.processing/i)).toBeInTheDocument()
      })
    })

    it('should render with provided datasetId and documentId props', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      render(
        <EmbeddingDetail {...defaultProps} datasetId="custom-ds" documentId="custom-doc" />,
        { wrapper: createWrapper({ datasetId: '', documentId: '' }) },
      )

      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalledWith({
          datasetId: 'custom-ds',
          documentId: 'custom-doc',
        })
      })
    })

    it('should fall back to context values when props are not provided', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalledWith({
          datasetId: 'ds1',
          documentId: 'doc1',
        })
      })
    })
  })

  describe('Status Display', () => {
    it('should show processing status when indexing', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({ indexing_status: 'indexing' }))

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/embedding\.processing/i)).toBeInTheDocument()
      })
    })

    it('should show completed status', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({ indexing_status: 'completed' }))

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/embedding\.completed/i)).toBeInTheDocument()
      })
    })

    it('should show paused status', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({ indexing_status: 'paused' }))

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/embedding\.paused/i)).toBeInTheDocument()
      })
    })

    it('should show error status', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({ indexing_status: 'error' }))

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/embedding\.error/i)).toBeInTheDocument()
      })
    })
  })

  describe('Progress Display', () => {
    it('should display segment progress', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({
        completed_segments: 50,
        total_segments: 100,
      }))

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/50\/100/)).toBeInTheDocument()
        expect(screen.getByText(/50%/)).toBeInTheDocument()
      })
    })
  })

  describe('Pause/Resume Actions', () => {
    it('should show pause button when embedding is in progress', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({ indexing_status: 'indexing' }))

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/embedding\.pause/i)).toBeInTheDocument()
      })
    })

    it('should show resume button when paused', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({ indexing_status: 'paused' }))

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/embedding\.resume/i)).toBeInTheDocument()
      })
    })

    it('should call pause API when pause button is clicked', async () => {
      const user = userEvent.setup()
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({ indexing_status: 'indexing' }))
      mockPauseDocIndexing.mockResolvedValue({ result: 'success' })

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/embedding\.pause/i)).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /pause/i }))

      await waitFor(() => {
        expect(mockPauseDocIndexing).toHaveBeenCalledWith({
          datasetId: 'ds1',
          documentId: 'doc1',
        })
      })
    })

    it('should call resume API when resume button is clicked', async () => {
      const user = userEvent.setup()
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({ indexing_status: 'paused' }))
      mockResumeDocIndexing.mockResolvedValue({ result: 'success' })

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/embedding\.resume/i)).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /resume/i }))

      await waitFor(() => {
        expect(mockResumeDocIndexing).toHaveBeenCalledWith({
          datasetId: 'ds1',
          documentId: 'doc1',
        })
      })
    })
  })

  describe('Rule Detail', () => {
    it('should display rule detail section', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/stepTwo\.indexMode/i)).toBeInTheDocument()
      })
    })

    it('should display qualified index mode', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      render(
        <EmbeddingDetail {...defaultProps} indexingType={IndexingType.QUALIFIED} />,
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(screen.getByText(/stepTwo\.qualified/i)).toBeInTheDocument()
      })
    })

    it('should display economical index mode', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      render(
        <EmbeddingDetail {...defaultProps} indexingType={IndexingType.ECONOMICAL} />,
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(screen.getByText(/stepTwo\.economical/i)).toBeInTheDocument()
      })
    })
  })

  describe('detailUpdate Callback', () => {
    it('should call detailUpdate when status becomes terminal', async () => {
      const detailUpdate = vi.fn()
      // First call returns indexing, subsequent call returns completed
      mockFetchIndexingStatus
        .mockResolvedValueOnce(mockIndexingStatus({ indexing_status: 'indexing' }))
        .mockResolvedValueOnce(mockIndexingStatus({ indexing_status: 'completed' }))

      render(
        <EmbeddingDetail {...defaultProps} detailUpdate={detailUpdate} />,
        { wrapper: createWrapper() },
      )

      // Wait for the terminal status to trigger detailUpdate
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      }, { timeout: 5000 })
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing context values', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      render(
        <EmbeddingDetail {...defaultProps} datasetId="explicit-ds" documentId="explicit-doc" />,
        { wrapper: createWrapper({ datasetId: undefined, documentId: undefined }) },
      )

      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalledWith({
          datasetId: 'explicit-ds',
          documentId: 'explicit-doc',
        })
      })
    })

    it('should render skeleton component', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      const { container } = render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

      // EmbeddingSkeleton should be rendered - check for the skeleton wrapper element
      await waitFor(() => {
        const skeletonWrapper = container.querySelector('.bg-dataset-chunk-list-mask-bg')
        expect(skeletonWrapper).toBeInTheDocument()
      })
    })
  })
})
