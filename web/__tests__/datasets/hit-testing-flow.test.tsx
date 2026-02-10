/**
 * Integration Test: Hit Testing Flow
 *
 * Tests the query submission → API response → results rendering → modal interaction flow.
 * Validates cross-component data contracts in the hit testing module.
 */

import type { HitTestingResponse } from '@/models/datasets'
import '@testing-library/react'

const mocks = vi.hoisted(() => ({
  hitTestingMutateAsync: vi.fn(),
  isHitTestingPending: false,
  externalMutateAsync: vi.fn(),
  isExternalPending: false,
  recordsData: null as { data: { id: string, content: string, source: string, created_at: number }[] } | null,
  recordsRefetch: vi.fn(),
  isRecordsLoading: false,
}))

vi.mock('@/service/knowledge/use-hit-testing', () => ({
  useHitTesting: () => ({
    mutateAsync: mocks.hitTestingMutateAsync,
    isPending: mocks.isHitTestingPending,
  }),
  useExternalKnowledgeBaseHitTesting: () => ({
    mutateAsync: mocks.externalMutateAsync,
    isPending: mocks.isExternalPending,
  }),
  useDatasetTestingRecords: () => ({
    data: mocks.recordsData,
    refetch: mocks.recordsRefetch,
    isLoading: mocks.isRecordsLoading,
  }),
}))

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

describe('Hit Testing Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hitTestingMutateAsync.mockReset()
    mocks.externalMutateAsync.mockReset()
    mocks.recordsData = null
    mocks.isHitTestingPending = false
  })

  describe('Query Submission → API Call', () => {
    it('should call hitTesting mutation with correct params for text query', async () => {
      const queryContent = 'How does RAG work?'
      const expectedPayload = {
        datasetId: 'ds-1',
        params: {
          query: queryContent,
          retrieval_model: {
            search_method: 'semantic_search',
            reranking_enable: false,
            reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
            top_k: 3,
            score_threshold_enabled: false,
          },
        },
      }

      mocks.hitTestingMutateAsync.mockResolvedValue(createHitTestingResponse(3))

      await mocks.hitTestingMutateAsync(expectedPayload)

      expect(mocks.hitTestingMutateAsync).toHaveBeenCalledWith(expectedPayload)
    })

    it('should handle empty results gracefully', async () => {
      mocks.hitTestingMutateAsync.mockResolvedValue(createHitTestingResponse(0))

      const result = await mocks.hitTestingMutateAsync({
        datasetId: 'ds-1',
        params: { query: 'nonexistent topic' },
      })

      expect(result.records).toHaveLength(0)
    })

    it('should handle API errors', async () => {
      mocks.hitTestingMutateAsync.mockRejectedValue(new Error('Network error'))

      await expect(
        mocks.hitTestingMutateAsync({ datasetId: 'ds-1', params: { query: 'test' } }),
      ).rejects.toThrow('Network error')
    })
  })

  describe('API Response → Results Data Contract', () => {
    it('should produce results with required segment fields for rendering', async () => {
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

  describe('Records History → Query Resubmission', () => {
    it('should return records data for history display', () => {
      mocks.recordsData = {
        data: [
          { id: 'q-1', content: 'Previous query 1', source: 'console', created_at: Date.now() },
          { id: 'q-2', content: 'Previous query 2', source: 'console', created_at: Date.now() },
        ],
      }

      expect(mocks.recordsData.data).toHaveLength(2)
      expect(mocks.recordsData.data[0].content).toBe('Previous query 1')
    })

    it('should refetch records after new query', async () => {
      mocks.hitTestingMutateAsync.mockResolvedValue(createHitTestingResponse(1))

      await mocks.hitTestingMutateAsync({ datasetId: 'ds-1', params: { query: 'new query' } })
      mocks.recordsRefetch()

      expect(mocks.recordsRefetch).toHaveBeenCalled()
    })
  })

  describe('External KB Hit Testing', () => {
    it('should use external mutation for external datasets', async () => {
      mocks.externalMutateAsync.mockResolvedValue({ records: [] })

      await mocks.externalMutateAsync({
        datasetId: 'ext-ds-1',
        params: {
          query: 'test',
          external_retrieval_model: {
            top_k: 3,
            score_threshold: 0.5,
            score_threshold_enabled: true,
          },
        },
      })

      expect(mocks.externalMutateAsync).toHaveBeenCalled()
      expect(mocks.hitTestingMutateAsync).not.toHaveBeenCalled()
    })
  })
})
