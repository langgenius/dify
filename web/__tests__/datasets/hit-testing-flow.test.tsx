/**
 * Integration Test: Hit Testing Flow
 *
 * Tests the query submission → API response → callback chain flow
 * by rendering the actual QueryInput component and triggering user interactions.
 * Validates that the production onSubmit logic correctly constructs payloads
 * and invokes callbacks on success/failure.
 */

import type {
  HitTestingResponse,
  Query,
} from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import QueryInput from '@/app/components/datasets/hit-testing/components/query-input'
import { RETRIEVE_METHOD } from '@/types/app'

// --- Mocks ---

vi.mock('@/context/dataset-detail', () => ({
  default: {},
  useDatasetDetailContext: vi.fn(() => ({ dataset: undefined })),
  useDatasetDetailContextWithSelector: vi.fn(() => false),
}))

vi.mock('use-context-selector', () => ({
  useContext: vi.fn(() => ({})),
  useContextSelector: vi.fn(() => false),
  createContext: vi.fn(() => ({})),
}))

vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-retrieval-testing', () => ({
  default: ({ textArea, actionButton }: { textArea: React.ReactNode, actionButton: React.ReactNode }) => (
    <div data-testid="image-uploader-mock">
      {textArea}
      {actionButton}
    </div>
  ),
}))

// --- Factories ---

const createRetrievalConfig = (overrides = {}): RetrievalConfig => ({
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_mode: undefined,
  reranking_model: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  weights: undefined,
  top_k: 3,
  score_threshold_enabled: false,
  score_threshold: 0.5,
  ...overrides,
} as RetrievalConfig)

const createHitTestingResponse = (numResults: number): HitTestingResponse => ({
  query: {
    content: 'What is Dify?',
    tsne_position: { x: 0, y: 0 },
  },
  records: Array.from({ length: numResults }, (_, i) => ({
    segment: {
      id: `seg-${i}`,
      document: {
        id: `doc-${i}`,
        data_source_type: 'upload_file',
        name: `document-${i}.txt`,
        doc_type: null as unknown as import('@/models/datasets').DocType,
      },
      content: `Result content ${i}`,
      sign_content: `Result content ${i}`,
      position: i + 1,
      word_count: 100 + i * 50,
      tokens: 50 + i * 25,
      keywords: ['test', 'dify'],
      hit_count: i * 5,
      index_node_hash: `hash-${i}`,
      answer: '',
    },
    content: {
      id: `seg-${i}`,
      document: {
        id: `doc-${i}`,
        data_source_type: 'upload_file',
        name: `document-${i}.txt`,
        doc_type: null as unknown as import('@/models/datasets').DocType,
      },
      content: `Result content ${i}`,
      sign_content: `Result content ${i}`,
      position: i + 1,
      word_count: 100 + i * 50,
      tokens: 50 + i * 25,
      keywords: ['test', 'dify'],
      hit_count: i * 5,
      index_node_hash: `hash-${i}`,
      answer: '',
    },
    score: 0.95 - i * 0.1,
    tsne_position: { x: 0, y: 0 },
    child_chunks: null,
    files: [],
  })),
})

const createTextQuery = (content: string): Query[] => [
  { content, content_type: 'text_query', file_info: null },
]

// --- Helpers ---

const findSubmitButton = () => {
  const buttons = screen.getAllByRole('button')
  const submitButton = buttons.find(btn => btn.classList.contains('w-[88px]'))
  expect(submitButton).toBeTruthy()
  return submitButton!
}

// --- Tests ---

describe('Hit Testing Flow', () => {
  const mockHitTestingMutation = vi.fn()
  const mockExternalMutation = vi.fn()
  const mockSetHitResult = vi.fn()
  const mockSetExternalHitResult = vi.fn()
  const mockOnUpdateList = vi.fn()
  const mockSetQueries = vi.fn()
  const mockOnClickRetrievalMethod = vi.fn()
  const mockOnSubmit = vi.fn()

  const createDefaultProps = (overrides: Record<string, unknown> = {}) => ({
    onUpdateList: mockOnUpdateList,
    setHitResult: mockSetHitResult,
    setExternalHitResult: mockSetExternalHitResult,
    loading: false,
    queries: [] as Query[],
    setQueries: mockSetQueries,
    isExternal: false,
    onClickRetrievalMethod: mockOnClickRetrievalMethod,
    retrievalConfig: createRetrievalConfig(),
    isEconomy: false,
    onSubmit: mockOnSubmit,
    hitTestingMutation: mockHitTestingMutation,
    externalKnowledgeBaseHitTestingMutation: mockExternalMutation,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Query Submission → API Call', () => {
    it('should call hitTestingMutation with correct payload including retrieval model', async () => {
      const retrievalConfig = createRetrievalConfig({
        search_method: RETRIEVE_METHOD.semantic,
        top_k: 3,
        score_threshold_enabled: false,
      })
      mockHitTestingMutation.mockResolvedValue(createHitTestingResponse(3))

      render(
        <QueryInput {...createDefaultProps({
          queries: createTextQuery('How does RAG work?'),
          retrievalConfig,
        })}
        />,
      )

      fireEvent.click(findSubmitButton())

      await waitFor(() => {
        expect(mockHitTestingMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'How does RAG work?',
            attachment_ids: [],
            retrieval_model: expect.objectContaining({
              search_method: RETRIEVE_METHOD.semantic,
              top_k: 3,
              score_threshold_enabled: false,
            }),
          }),
          expect.objectContaining({
            onSuccess: expect.any(Function),
          }),
        )
      })
    })

    it('should override search_method to keywordSearch when isEconomy is true', async () => {
      const retrievalConfig = createRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic })
      mockHitTestingMutation.mockResolvedValue(createHitTestingResponse(1))

      render(
        <QueryInput {...createDefaultProps({
          queries: createTextQuery('test query'),
          retrievalConfig,
          isEconomy: true,
        })}
        />,
      )

      fireEvent.click(findSubmitButton())

      await waitFor(() => {
        expect(mockHitTestingMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            retrieval_model: expect.objectContaining({
              search_method: RETRIEVE_METHOD.keywordSearch,
            }),
          }),
          expect.anything(),
        )
      })
    })

    it('should handle empty results by calling setHitResult with empty records', async () => {
      const emptyResponse = createHitTestingResponse(0)
      mockHitTestingMutation.mockImplementation(async (_params: unknown, options?: { onSuccess?: (data: HitTestingResponse) => void }) => {
        options?.onSuccess?.(emptyResponse)
        return emptyResponse
      })

      render(
        <QueryInput {...createDefaultProps({
          queries: createTextQuery('nonexistent topic'),
        })}
        />,
      )

      fireEvent.click(findSubmitButton())

      await waitFor(() => {
        expect(mockSetHitResult).toHaveBeenCalledWith(
          expect.objectContaining({ records: [] }),
        )
      })
    })

    it('should not call success callbacks when mutation resolves without onSuccess', async () => {
      // Simulate a mutation that resolves but does not invoke the onSuccess callback
      mockHitTestingMutation.mockResolvedValue(undefined)

      render(
        <QueryInput {...createDefaultProps({
          queries: createTextQuery('test'),
        })}
        />,
      )

      fireEvent.click(findSubmitButton())

      await waitFor(() => {
        expect(mockHitTestingMutation).toHaveBeenCalled()
      })
      // Success callbacks should not fire when onSuccess is not invoked
      expect(mockSetHitResult).not.toHaveBeenCalled()
      expect(mockOnUpdateList).not.toHaveBeenCalled()
      expect(mockOnSubmit).not.toHaveBeenCalled()
    })
  })

  describe('API Response → Results Data Contract', () => {
    it('should produce results with required segment fields for rendering', () => {
      const response = createHitTestingResponse(3)

      // Validate each result has the fields needed by ResultItem component
      response.records.forEach((record) => {
        expect(record.segment).toHaveProperty('id')
        expect(record.segment).toHaveProperty('content')
        expect(record.segment).toHaveProperty('position')
        expect(record.segment).toHaveProperty('word_count')
        expect(record.segment).toHaveProperty('document')
        expect(record.segment.document).toHaveProperty('name')
        expect(record.score).toBeGreaterThanOrEqual(0)
        expect(record.score).toBeLessThanOrEqual(1)
      })
    })

    it('should maintain correct score ordering', () => {
      const response = createHitTestingResponse(5)

      for (let i = 1; i < response.records.length; i++) {
        expect(response.records[i - 1].score).toBeGreaterThanOrEqual(response.records[i].score)
      }
    })

    it('should include document metadata for result item display', () => {
      const response = createHitTestingResponse(1)
      const record = response.records[0]

      expect(record.segment.document.name).toBeTruthy()
      expect(record.segment.document.data_source_type).toBeTruthy()
    })
  })

  describe('Successful Submission → Callback Chain', () => {
    it('should call setHitResult, onUpdateList, and onSubmit after successful submission', async () => {
      const response = createHitTestingResponse(3)
      mockHitTestingMutation.mockImplementation(async (_params: unknown, options?: { onSuccess?: (data: HitTestingResponse) => void }) => {
        options?.onSuccess?.(response)
        return response
      })

      render(
        <QueryInput {...createDefaultProps({
          queries: createTextQuery('Test query'),
        })}
        />,
      )

      fireEvent.click(findSubmitButton())

      await waitFor(() => {
        expect(mockSetHitResult).toHaveBeenCalledWith(response)
        expect(mockOnUpdateList).toHaveBeenCalledTimes(1)
        expect(mockOnSubmit).toHaveBeenCalledTimes(1)
      })
    })

    it('should trigger records list refresh via onUpdateList after query', async () => {
      const response = createHitTestingResponse(1)
      mockHitTestingMutation.mockImplementation(async (_params: unknown, options?: { onSuccess?: (data: HitTestingResponse) => void }) => {
        options?.onSuccess?.(response)
        return response
      })

      render(
        <QueryInput {...createDefaultProps({
          queries: createTextQuery('new query'),
        })}
        />,
      )

      fireEvent.click(findSubmitButton())

      await waitFor(() => {
        expect(mockOnUpdateList).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('External KB Hit Testing', () => {
    it('should use external mutation with correct payload for external datasets', async () => {
      mockExternalMutation.mockImplementation(async (_params: unknown, options?: { onSuccess?: (data: { records: never[] }) => void }) => {
        const response = { records: [] }
        options?.onSuccess?.(response)
        return response
      })

      render(
        <QueryInput {...createDefaultProps({
          queries: createTextQuery('test'),
          isExternal: true,
        })}
        />,
      )

      fireEvent.click(findSubmitButton())

      await waitFor(() => {
        expect(mockExternalMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'test',
            external_retrieval_model: expect.objectContaining({
              top_k: 4,
              score_threshold: 0.5,
              score_threshold_enabled: false,
            }),
          }),
          expect.objectContaining({
            onSuccess: expect.any(Function),
          }),
        )
        // Internal mutation should NOT be called
        expect(mockHitTestingMutation).not.toHaveBeenCalled()
      })
    })

    it('should call setExternalHitResult and onUpdateList on successful external submission', async () => {
      const externalResponse = { records: [] }
      mockExternalMutation.mockImplementation(async (_params: unknown, options?: { onSuccess?: (data: { records: never[] }) => void }) => {
        options?.onSuccess?.(externalResponse)
        return externalResponse
      })

      render(
        <QueryInput {...createDefaultProps({
          queries: createTextQuery('external query'),
          isExternal: true,
        })}
        />,
      )

      fireEvent.click(findSubmitButton())

      await waitFor(() => {
        expect(mockSetExternalHitResult).toHaveBeenCalledWith(externalResponse)
        expect(mockOnUpdateList).toHaveBeenCalledTimes(1)
      })
    })
  })
})
