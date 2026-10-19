import type {
  DocumentStatusResponse,
  ProcessRuleResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import type { DocumentContextValue } from '../../context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ProcessMode } from '@/models/datasets'
import * as datasetsService from '@/service/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../../create/step-two'
import { DocumentContext } from '../../context'
import EmbeddingDetail from '../index'

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

vi.mock('@/service/datasets')
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
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.processRule.get': () => mockProcessRule(),
    }),
  }
})
vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

const mockFetchIndexingStatus = vi.mocked(datasetsService.fetchIndexingStatus)
const mockPauseDocIndexing = vi.mocked(datasetsService.pauseDocIndexing)
const mockResumeDocIndexing = vi.mocked(datasetsService.resumeDocIndexing)

const createConsoleQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  return queryClient
}

const createWrapper = (
  contextValue: DocumentContextValue = { datasetId: 'ds1', documentId: 'doc1' },
) => {
  const queryClient = createConsoleQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <>
        <DocumentContext.Provider value={contextValue}>{children}</DocumentContext.Provider>
      </>
    </QueryClientProvider>
  )
}

const mockIndexingStatus = (
  overrides: Partial<DocumentStatusResponse> = {},
): DocumentStatusResponse => ({
  id: 'doc1',
  indexing_status: 'indexing',
  completed_segments: 50,
  total_segments: 100,
  processing_started_at: 1700000000,
  parsing_completed_at: 0,
  cleaning_completed_at: 0,
  splitting_completed_at: 0,
  completed_at: null,
  paused_at: null,
  error: null,
  stopped_at: null,
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
  })

  describe('Rendering', () => {
    it('should render with provided datasetId and documentId props', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      render(<EmbeddingDetail {...defaultProps} datasetId="custom-ds" documentId="custom-doc" />, {
        wrapper: createWrapper({ datasetId: '', documentId: '' }),
      })

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

  describe('Pause/Resume Actions', () => {
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

  it('refreshes document details when indexing reaches completion', async () => {
    mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())
    const detailUpdate = vi.fn()
    const queryClient = createConsoleQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <EmbeddingDetail
          {...defaultProps}
          datasetId="ds1"
          documentId="doc1"
          detailUpdate={detailUpdate}
        />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/50\/100/)).toBeInTheDocument()
    expect(detailUpdate).not.toHaveBeenCalled()
    act(() =>
      queryClient.setQueryData(
        ['embedding', 'indexing-status', 'ds1', 'doc1'],
        mockIndexingStatus({ indexing_status: 'completed' }),
      ),
    )
    await waitFor(() => expect(detailUpdate).toHaveBeenCalledOnce())
    expect(screen.getByText(/embedding\.completed/i)).toBeInTheDocument()
  })
})
