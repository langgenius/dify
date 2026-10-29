import type {
  DocumentStatusResponse,
  ProcessRuleResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import type { DocumentContextValue } from '../../context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ProcessMode } from '@/models/datasets'
import * as datasetsService from '@/service/datasets'
import { createDeferred } from '@/test/deferred'
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

vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  fetchIndexingStatus: vi.fn(),
}))
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

const indexingActions = [
  { action: 'pause', initialStatus: 'indexing', nextStatus: 'paused' },
  { action: 'resume', initialStatus: 'paused', nextStatus: 'indexing' },
] as const

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

  afterEach(() => {
    vi.restoreAllMocks()
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
    it.each(indexingActions)(
      'shows the updated status without a success toast after $action',
      async ({ action, initialStatus, nextStatus }) => {
        const user = userEvent.setup()
        const response = createDeferred<Response>()
        const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(response.promise)
        mockFetchIndexingStatus.mockResolvedValue(
          mockIndexingStatus({ indexing_status: initialStatus }),
        )

        render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

        const button = await screen.findByRole('button', { name: new RegExp(action, 'i') })
        await user.click(button)
        await waitFor(() => expect(button).toBeDisabled())
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
        const [request] = fetch.mock.calls[0]!
        expect(request).toBeInstanceOf(Request)
        if (!(request instanceof Request)) throw new TypeError('Expected a Request')
        expect(request.method).toBe('PATCH')
        expect(new URL(request.url).pathname).toContain(
          `/datasets/ds1/documents/doc1/processing/${action}`,
        )

        mockFetchIndexingStatus.mockResolvedValue(
          mockIndexingStatus({ indexing_status: nextStatus }),
        )
        response.resolve(Response.json({ result: 'success' }))

        const status = nextStatus === 'indexing' ? 'processing' : nextStatus
        expect(
          await screen.findByText(`datasetDocuments.embedding.${status}`, {}, { timeout: 4000 }),
        ).toBeInTheDocument()
        expect(mockToast.success).not.toHaveBeenCalled()
      },
    )

    it.each(indexingActions)(
      'reports a failed $action once and keeps the previous status',
      async ({ action, initialStatus }) => {
        const user = userEvent.setup()
        const response = createDeferred<Response>()
        vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(response.promise)
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mockFetchIndexingStatus.mockResolvedValue(
          mockIndexingStatus({ indexing_status: initialStatus }),
        )

        render(<EmbeddingDetail {...defaultProps} />, { wrapper: createWrapper() })

        const button = await screen.findByRole('button', { name: new RegExp(action, 'i') })
        await user.click(button)
        await waitFor(() => expect(button).toBeDisabled())
        const message = `Cannot ${action} this document`
        response.resolve(
          Response.json({ code: 'invalid_param', message, status: 400 }, { status: 400 }),
        )

        await waitFor(() => expect(button).toBeEnabled())
        const status = initialStatus === 'indexing' ? 'processing' : initialStatus
        expect(screen.getByText(`datasetDocuments.embedding.${status}`)).toBeInTheDocument()
        expect(mockToast.error).toHaveBeenCalledExactlyOnceWith(message)
      },
    )
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
