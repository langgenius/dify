/**
 * Integration Test: Create Dataset Flow
 *
 * Tests cross-module data flow: step-one data → step-two hooks → creation params → API call
 * Validates data contracts between steps.
 */

import type { CustomFile } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode, DataSourceType, ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'

const mockCreateFirstDocument = vi.fn()
const mockCreateDocument = vi.fn()
vi.mock('@/service/knowledge/use-create-dataset', () => ({
  useCreateFirstDocument: () => ({ mutateAsync: mockCreateFirstDocument, isPending: false }),
  useCreateDocument: () => ({ mutateAsync: mockCreateDocument, isPending: false }),
  getNotionInfo: (pages: { page_id: string }[], credentialId: string) => ({
    workspace_id: 'ws-1',
    pages: pages.map(p => p.page_id),
    notion_credential_id: credentialId,
  }),
  getWebsiteInfo: (opts: { websitePages: { url: string }[], websiteCrawlProvider: string }) => ({
    urls: opts.websitePages.map(p => p.url),
    only_main_content: true,
    provider: opts.websiteCrawlProvider,
  }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => vi.fn(),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

// Import hooks after mocks
const { useSegmentationState, DEFAULT_SEGMENT_IDENTIFIER, DEFAULT_MAXIMUM_CHUNK_LENGTH, DEFAULT_OVERLAP }
  = await import('@/app/components/datasets/create/step-two/hooks')
const { useDocumentCreation, IndexingType }
  = await import('@/app/components/datasets/create/step-two/hooks')

const createMockFile = (overrides?: Partial<CustomFile>): CustomFile => ({
  id: 'file-1',
  name: 'test.txt',
  type: 'text/plain',
  size: 1024,
  extension: '.txt',
  mime_type: 'text/plain',
  created_at: 0,
  created_by: '',
  ...overrides,
} as CustomFile)

describe('Create Dataset Flow - Cross-Step Data Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Step-One → Step-Two: Segmentation Defaults', () => {
    it('should initialise with correct default segmentation values', () => {
      const { result } = renderHook(() => useSegmentationState())
      expect(result.current.segmentIdentifier).toBe(DEFAULT_SEGMENT_IDENTIFIER)
      expect(result.current.maxChunkLength).toBe(DEFAULT_MAXIMUM_CHUNK_LENGTH)
      expect(result.current.overlap).toBe(DEFAULT_OVERLAP)
      expect(result.current.segmentationType).toBe(ProcessMode.general)
    })

    it('should produce valid process rule for general chunking', () => {
      const { result } = renderHook(() => useSegmentationState())
      const processRule = result.current.getProcessRule(ChunkingMode.text)

      // mode should be segmentationType = ProcessMode.general = 'custom'
      expect(processRule.mode).toBe('custom')
      expect(processRule.rules.segmentation).toEqual({
        separator: '\n\n', // unescaped from \\n\\n
        max_tokens: DEFAULT_MAXIMUM_CHUNK_LENGTH,
        chunk_overlap: DEFAULT_OVERLAP,
      })
      // rules is empty initially since no default config loaded
      expect(processRule.rules.pre_processing_rules).toEqual([])
    })

    it('should produce valid process rule for parent-child chunking', () => {
      const { result } = renderHook(() => useSegmentationState())
      const processRule = result.current.getProcessRule(ChunkingMode.parentChild)

      expect(processRule.mode).toBe('hierarchical')
      expect(processRule.rules.parent_mode).toBe('paragraph')
      expect(processRule.rules.segmentation).toEqual({
        separator: '\n\n',
        max_tokens: 1024,
      })
      expect(processRule.rules.subchunk_segmentation).toEqual({
        separator: '\n',
        max_tokens: 512,
      })
    })
  })

  describe('Step-Two → Creation API: Params Building', () => {
    it('should build valid creation params for file upload workflow', () => {
      const files = [createMockFile()]
      const { result: segResult } = renderHook(() => useSegmentationState())
      const { result: creationResult } = renderHook(() =>
        useDocumentCreation({
          dataSourceType: DataSourceType.FILE,
          files,
          notionPages: [],
          notionCredentialId: '',
          websitePages: [],
        }),
      )

      const processRule = segResult.current.getProcessRule(ChunkingMode.text)
      const retrievalConfig: RetrievalConfig = {
        search_method: RETRIEVE_METHOD.semantic,
        reranking_enable: false,
        reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
        top_k: 3,
        score_threshold_enabled: false,
        score_threshold: 0,
      }

      const params = creationResult.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        processRule,
        retrievalConfig,
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      expect(params).not.toBeNull()
      // File IDs come from file.id (not file.file.id)
      expect(params!.data_source.type).toBe(DataSourceType.FILE)
      expect(params!.data_source.info_list.file_info_list?.file_ids).toContain('file-1')

      expect(params!.indexing_technique).toBe(IndexingType.QUALIFIED)
      expect(params!.doc_form).toBe(ChunkingMode.text)
      expect(params!.doc_language).toBe('English')
      expect(params!.embedding_model).toBe('text-embedding-ada-002')
      expect(params!.embedding_model_provider).toBe('openai')
      expect(params!.process_rule.mode).toBe('custom')
    })

    it('should validate params: overlap must not exceed maxChunkLength', () => {
      const { result } = renderHook(() =>
        useDocumentCreation({
          dataSourceType: DataSourceType.FILE,
          files: [createMockFile()],
          notionPages: [],
          notionCredentialId: '',
          websitePages: [],
        }),
      )

      // validateParams returns false (invalid) when overlap > maxChunkLength for general mode
      const isValid = result.current.validateParams({
        segmentationType: 'general',
        maxChunkLength: 100,
        limitMaxChunkLength: 4000,
        overlap: 200, // overlap > maxChunkLength
        indexType: IndexingType.QUALIFIED,
        embeddingModel: { provider: 'openai', model: 'text-embedding-ada-002' },
        rerankModelList: [],
        retrievalConfig: {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0,
        },
      })
      expect(isValid).toBe(false)
    })

    it('should validate params: maxChunkLength must not exceed limit', () => {
      const { result } = renderHook(() =>
        useDocumentCreation({
          dataSourceType: DataSourceType.FILE,
          files: [createMockFile()],
          notionPages: [],
          notionCredentialId: '',
          websitePages: [],
        }),
      )

      const isValid = result.current.validateParams({
        segmentationType: 'general',
        maxChunkLength: 5000,
        limitMaxChunkLength: 4000, // limit < maxChunkLength
        overlap: 50,
        indexType: IndexingType.QUALIFIED,
        embeddingModel: { provider: 'openai', model: 'text-embedding-ada-002' },
        rerankModelList: [],
        retrievalConfig: {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0,
        },
      })
      expect(isValid).toBe(false)
    })
  })

  describe('Full Flow: Segmentation State → Process Rule → Creation Params Consistency', () => {
    it('should keep segmentation values consistent across getProcessRule and buildCreationParams', () => {
      const files = [createMockFile()]
      const { result: segResult } = renderHook(() => useSegmentationState())
      const { result: creationResult } = renderHook(() =>
        useDocumentCreation({
          dataSourceType: DataSourceType.FILE,
          files,
          notionPages: [],
          notionCredentialId: '',
          websitePages: [],
        }),
      )

      // Change segmentation settings
      act(() => {
        segResult.current.setMaxChunkLength(2048)
        segResult.current.setOverlap(100)
      })

      const processRule = segResult.current.getProcessRule(ChunkingMode.text)
      expect(processRule.rules.segmentation.max_tokens).toBe(2048)
      expect(processRule.rules.segmentation.chunk_overlap).toBe(100)

      const params = creationResult.current.buildCreationParams(
        ChunkingMode.text,
        'Chinese',
        processRule,
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      expect(params).not.toBeNull()
      expect(params!.process_rule.rules.segmentation.max_tokens).toBe(2048)
      expect(params!.process_rule.rules.segmentation.chunk_overlap).toBe(100)
      expect(params!.doc_language).toBe('Chinese')
    })

    it('should support parent-child mode through the full pipeline', () => {
      const files = [createMockFile()]
      const { result: segResult } = renderHook(() => useSegmentationState())
      const { result: creationResult } = renderHook(() =>
        useDocumentCreation({
          dataSourceType: DataSourceType.FILE,
          files,
          notionPages: [],
          notionCredentialId: '',
          websitePages: [],
        }),
      )

      const processRule = segResult.current.getProcessRule(ChunkingMode.parentChild)
      const params = creationResult.current.buildCreationParams(
        ChunkingMode.parentChild,
        'English',
        processRule,
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      expect(params).not.toBeNull()
      expect(params!.doc_form).toBe(ChunkingMode.parentChild)
      expect(params!.process_rule.mode).toBe('hierarchical')
      expect(params!.process_rule.rules.parent_mode).toBe('paragraph')
      expect(params!.process_rule.rules.subchunk_segmentation).toBeDefined()
    })
  })
})
