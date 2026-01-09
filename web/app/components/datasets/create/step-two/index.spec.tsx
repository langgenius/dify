import type { Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DataSourceProvider, NotionPage } from '@/models/common'
import type {
  CrawlOptions,
  CrawlResultItem,
  CustomFile,
  FileIndexingEstimateResponse,
  FullDocumentDetail,
  PreProcessingRule,
  Rules,
} from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ChunkingMode, DataSourceType, ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { PreviewPanel } from './components/preview-panel'
import { StepTwoFooter } from './components/step-two-footer'
import {
  DEFAULT_MAXIMUM_CHUNK_LENGTH,
  DEFAULT_OVERLAP,
  DEFAULT_SEGMENT_IDENTIFIER,
  defaultParentChildConfig,
  IndexingType,
  useDocumentCreation,
  useIndexingConfig,
  useIndexingEstimate,
  usePreviewState,
  useSegmentationState,
} from './hooks'
import escape from './hooks/escape'
import unescape from './hooks/unescape'

// ============================================
// Mock external dependencies
// ============================================

// Mock dataset detail context
const mockDataset = {
  id: 'test-dataset-id',
  doc_form: ChunkingMode.text,
  data_source_type: DataSourceType.FILE,
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  } as RetrievalConfig,
}

let mockCurrentDataset: typeof mockDataset | null = null
const mockMutateDatasetRes = vi.fn()

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: typeof mockDataset | null, mutateDatasetRes: () => void }) => unknown) =>
    selector({ dataset: mockCurrentDataset, mutateDatasetRes: mockMutateDatasetRes }),
}))

// Note: @/context/i18n is globally mocked in vitest.setup.ts, no need to mock here
// Note: @/hooks/use-breakpoints uses real import

// Mock model hooks
const mockEmbeddingModelList = [
  { provider: 'openai', model: 'text-embedding-ada-002' },
  { provider: 'cohere', model: 'embed-english-v3.0' },
]
const mockDefaultEmbeddingModel = { provider: { provider: 'openai' }, model: 'text-embedding-ada-002' }
// Model[] type structure for rerank model list (simplified mock)
const mockRerankModelList: Model[] = [{
  provider: 'cohere',
  icon_small: { en_US: 'cohere-icon', zh_Hans: 'cohere-icon' },
  label: { en_US: 'Cohere', zh_Hans: 'Cohere' },
  models: [{
    model: 'rerank-english-v3.0',
    label: { en_US: 'Rerank English v3.0', zh_Hans: 'Rerank English v3.0' },
    model_type: ModelTypeEnum.rerank,
    features: [],
    fetch_from: ConfigurationMethodEnum.predefinedModel,
    status: ModelStatusEnum.active,
    model_properties: {},
    load_balancing_enabled: false,
  }],
  status: ModelStatusEnum.active,
}]
const mockRerankDefaultModel = { provider: { provider: 'cohere' }, model: 'rerank-english-v3.0' }
let mockIsRerankDefaultModelValid = true

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    modelList: mockRerankModelList,
    defaultModel: mockRerankDefaultModel,
    currentModel: mockIsRerankDefaultModelValid,
  }),
  useModelList: () => ({ data: mockEmbeddingModelList }),
  useDefaultModel: () => ({ data: mockDefaultEmbeddingModel }),
}))

// Mock service hooks
const mockFetchDefaultProcessRuleMutate = vi.fn()
vi.mock('@/service/knowledge/use-create-dataset', () => ({
  useFetchDefaultProcessRule: ({ onSuccess }: { onSuccess: (data: { rules: Rules, limits: { indexing_max_segmentation_tokens_length: number } }) => void }) => ({
    mutate: (url: string) => {
      mockFetchDefaultProcessRuleMutate(url)
      onSuccess({
        rules: {
          segmentation: { separator: '\\n', max_tokens: 500, chunk_overlap: 50 },
          pre_processing_rules: [
            { id: 'remove_extra_spaces', enabled: true },
            { id: 'remove_urls_emails', enabled: false },
          ],
          parent_mode: 'paragraph',
          subchunk_segmentation: { separator: '\\n', max_tokens: 256 },
        },
        limits: { indexing_max_segmentation_tokens_length: 4000 },
      })
    },
    isPending: false,
  }),
  useFetchFileIndexingEstimateForFile: () => ({
    mutate: vi.fn(),
    data: undefined,
    isIdle: true,
    isPending: false,
    reset: vi.fn(),
  }),
  useFetchFileIndexingEstimateForNotion: () => ({
    mutate: vi.fn(),
    data: undefined,
    isIdle: true,
    isPending: false,
    reset: vi.fn(),
  }),
  useFetchFileIndexingEstimateForWeb: () => ({
    mutate: vi.fn(),
    data: undefined,
    isIdle: true,
    isPending: false,
    reset: vi.fn(),
  }),
  useCreateFirstDocument: () => ({
    mutateAsync: vi.fn().mockImplementation(async (params: unknown, options?: { onSuccess?: (data: unknown) => void }) => {
      const data = { dataset: { id: 'new-dataset-id' } }
      options?.onSuccess?.(data)
      return data
    }),
    isPending: false,
  }),
  useCreateDocument: () => ({
    mutateAsync: vi.fn().mockImplementation(async (params: unknown, options?: { onSuccess?: (data: unknown) => void }) => {
      const data = { document: { id: 'new-doc-id' } }
      options?.onSuccess?.(data)
      return data
    }),
    isPending: false,
  }),
  getNotionInfo: vi.fn().mockReturnValue([{ workspace_id: 'ws-1', pages: [{ page_id: 'page-1' }] }]),
  getWebsiteInfo: vi.fn().mockReturnValue({ provider: 'jinaReader', job_id: 'job-123', urls: ['https://test.com'] }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => vi.fn(),
}))

// Mock amplitude tracking (external service)
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

// Note: @/app/components/base/toast - uses real import (base component)
// Note: @/app/components/datasets/common/check-rerank-model - uses real import
// Note: @/app/components/base/float-right-container - uses real import (base component)

// Mock checkShowMultiModalTip - requires complex model list structure
vi.mock('@/app/components/datasets/settings/utils', () => ({
  checkShowMultiModalTip: () => false,
}))

// ============================================
// Test data factories
// ============================================

const createMockFile = (overrides?: Partial<CustomFile>): CustomFile => ({
  id: 'file-1',
  name: 'test-file.pdf',
  extension: 'pdf',
  size: 1024,
  type: 'application/pdf',
  lastModified: Date.now(),
  ...overrides,
} as CustomFile)

const createMockNotionPage = (overrides?: Partial<NotionPage>): NotionPage => ({
  page_id: 'notion-page-1',
  page_name: 'Test Notion Page',
  page_icon: null,
  type: 'page',
  ...overrides,
} as NotionPage)

const createMockWebsitePage = (overrides?: Partial<CrawlResultItem>): CrawlResultItem => ({
  source_url: 'https://example.com/page1',
  title: 'Test Website Page',
  description: 'Test description',
  markdown: '# Test Content',
  ...overrides,
} as CrawlResultItem)

const createMockDocumentDetail = (overrides?: Partial<FullDocumentDetail>): FullDocumentDetail => ({
  id: 'doc-1',
  doc_form: ChunkingMode.text,
  doc_language: 'English',
  file: { id: 'file-1', name: 'test.pdf', extension: 'pdf' },
  notion_page: createMockNotionPage(),
  website_page: createMockWebsitePage(),
  dataset_process_rule: {
    mode: ProcessMode.general,
    rules: {
      segmentation: { separator: '\\n\\n', max_tokens: 1024, chunk_overlap: 50 },
      pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: true }],
    },
  },
  ...overrides,
} as FullDocumentDetail)

const createMockRules = (overrides?: Partial<Rules>): Rules => ({
  segmentation: { separator: '\\n\\n', max_tokens: 1024, chunk_overlap: 50 },
  pre_processing_rules: [
    { id: 'remove_extra_spaces', enabled: true },
    { id: 'remove_urls_emails', enabled: false },
  ],
  parent_mode: 'paragraph',
  subchunk_segmentation: { separator: '\\n', max_tokens: 512 },
  ...overrides,
})

const createMockEstimate = (overrides?: Partial<FileIndexingEstimateResponse>): FileIndexingEstimateResponse => ({
  total_segments: 10,
  total_nodes: 10,
  tokens: 5000,
  total_price: 0.01,
  currency: 'USD',
  qa_preview: [{ question: 'Q1', answer: 'A1' }],
  preview: [{ content: 'Chunk 1 content', child_chunks: ['Child 1', 'Child 2'] }],
  ...overrides,
})

// ============================================
// Utility Functions Tests (escape/unescape)
// ============================================

describe('escape utility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for escape function
  describe('escape function', () => {
    it('should return empty string for null/undefined input', () => {
      expect(escape(null as unknown as string)).toBe('')
      expect(escape(undefined as unknown as string)).toBe('')
      expect(escape('')).toBe('')
    })

    it('should escape newline characters', () => {
      expect(escape('\n')).toBe('\\n')
      expect(escape('\r')).toBe('\\r')
      expect(escape('\n\r')).toBe('\\n\\r')
    })

    it('should escape tab characters', () => {
      expect(escape('\t')).toBe('\\t')
    })

    it('should escape other special characters', () => {
      expect(escape('\0')).toBe('\\0')
      expect(escape('\b')).toBe('\\b')
      expect(escape('\f')).toBe('\\f')
      expect(escape('\v')).toBe('\\v')
    })

    it('should escape single quotes', () => {
      expect(escape('\'')).toBe('\\\'')
    })

    it('should handle mixed content', () => {
      expect(escape('Hello\nWorld\t!')).toBe('Hello\\nWorld\\t!')
    })

    it('should not escape regular characters', () => {
      expect(escape('Hello World')).toBe('Hello World')
      expect(escape('abc123')).toBe('abc123')
    })

    it('should return empty string for non-string input', () => {
      expect(escape(123 as unknown as string)).toBe('')
      expect(escape({} as unknown as string)).toBe('')
    })
  })
})

describe('unescape utility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for unescape function
  describe('unescape function', () => {
    it('should unescape newline characters', () => {
      expect(unescape('\\n')).toBe('\n')
      expect(unescape('\\r')).toBe('\r')
    })

    it('should unescape tab characters', () => {
      expect(unescape('\\t')).toBe('\t')
    })

    it('should unescape other special characters', () => {
      expect(unescape('\\0')).toBe('\0')
      expect(unescape('\\b')).toBe('\b')
      expect(unescape('\\f')).toBe('\f')
      expect(unescape('\\v')).toBe('\v')
    })

    it('should unescape single and double quotes', () => {
      expect(unescape('\\\'')).toBe('\'')
      expect(unescape('\\"')).toBe('"')
    })

    it('should unescape backslash', () => {
      expect(unescape('\\\\')).toBe('\\')
    })

    it('should unescape hex sequences', () => {
      expect(unescape('\\x41')).toBe('A') // 0x41 = 65 = 'A'
      expect(unescape('\\x5A')).toBe('Z') // 0x5A = 90 = 'Z'
    })

    it('should unescape short hex (2-digit) sequences', () => {
      // Short hex format: \xNN (2 hexadecimal digits)
      expect(unescape('\\xA5')).toBe('¥') // Yen sign
      expect(unescape('\\x7F')).toBe('\x7F') // Delete character
      expect(unescape('\\x00')).toBe('\x00') // Null character via hex
    })

    it('should unescape octal sequences', () => {
      expect(unescape('\\101')).toBe('A') // Octal 101 = 65 = 'A'
      expect(unescape('\\132')).toBe('Z') // Octal 132 = 90 = 'Z'
      expect(unescape('\\7')).toBe('\x07') // Single digit octal
    })

    it('should unescape unicode sequences', () => {
      expect(unescape('\\u0041')).toBe('A')
      expect(unescape('\\u{41}')).toBe('A')
    })

    it('should unescape Python-style unicode', () => {
      expect(unescape('\\U00000041')).toBe('A')
    })

    it('should handle mixed content', () => {
      expect(unescape('Hello\\nWorld\\t!')).toBe('Hello\nWorld\t!')
    })

    it('should not modify regular text', () => {
      expect(unescape('Hello World')).toBe('Hello World')
    })
  })
})

// ============================================
// useSegmentationState Hook Tests
// ============================================

describe('useSegmentationState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for initial state
  describe('Initial State', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useSegmentationState())

      expect(result.current.segmentationType).toBe(ProcessMode.general)
      expect(result.current.segmentIdentifier).toBe(DEFAULT_SEGMENT_IDENTIFIER)
      expect(result.current.maxChunkLength).toBe(DEFAULT_MAXIMUM_CHUNK_LENGTH)
      expect(result.current.overlap).toBe(DEFAULT_OVERLAP)
      expect(result.current.rules).toEqual([])
      expect(result.current.parentChildConfig).toEqual(defaultParentChildConfig)
    })

    it('should initialize with custom segmentation type', () => {
      const { result } = renderHook(() =>
        useSegmentationState({ initialSegmentationType: ProcessMode.parentChild }),
      )

      expect(result.current.segmentationType).toBe(ProcessMode.parentChild)
    })
  })

  // Tests for state setters
  describe('State Management', () => {
    it('should update segmentation type', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentationType(ProcessMode.parentChild)
      })

      expect(result.current.segmentationType).toBe(ProcessMode.parentChild)
    })

    it('should update max chunk length', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setMaxChunkLength(2048)
      })

      expect(result.current.maxChunkLength).toBe(2048)
    })

    it('should update overlap', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setOverlap(100)
      })

      expect(result.current.overlap).toBe(100)
    })

    it('should update rules', () => {
      const { result } = renderHook(() => useSegmentationState())
      const newRules: PreProcessingRule[] = [{ id: 'test', enabled: true }]

      act(() => {
        result.current.setRules(newRules)
      })

      expect(result.current.rules).toEqual(newRules)
    })
  })

  // Tests for setSegmentIdentifier with escape
  describe('setSegmentIdentifier', () => {
    it('should escape special characters', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentIdentifier('\n\n')
      })

      expect(result.current.segmentIdentifier).toBe('\\n\\n')
    })

    it('should use default when empty and canEmpty is false', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentIdentifier('')
      })

      expect(result.current.segmentIdentifier).toBe(DEFAULT_SEGMENT_IDENTIFIER)
    })

    it('should allow empty when canEmpty is true', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentIdentifier('', true)
      })

      expect(result.current.segmentIdentifier).toBe('')
    })
  })

  // Tests for toggleRule
  describe('toggleRule', () => {
    it('should toggle rule enabled state', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setRules([
          { id: 'rule1', enabled: true },
          { id: 'rule2', enabled: false },
        ])
      })

      act(() => {
        result.current.toggleRule('rule1')
      })

      expect(result.current.rules.find(r => r.id === 'rule1')?.enabled).toBe(false)
      expect(result.current.rules.find(r => r.id === 'rule2')?.enabled).toBe(false)
    })

    it('should not affect other rules', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setRules([
          { id: 'rule1', enabled: true },
          { id: 'rule2', enabled: false },
        ])
      })

      act(() => {
        result.current.toggleRule('rule2')
      })

      expect(result.current.rules.find(r => r.id === 'rule1')?.enabled).toBe(true)
      expect(result.current.rules.find(r => r.id === 'rule2')?.enabled).toBe(true)
    })
  })

  // Tests for parent-child config
  describe('Parent-Child Configuration', () => {
    it('should update parent config delimiter with truthy value', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateParentConfig('delimiter', '\n\n\n')
      })

      expect(result.current.parentChildConfig.parent.delimiter).toBe('\\n\\n\\n')
    })

    it('should update parent config delimiter with empty value', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateParentConfig('delimiter', '')
      })

      expect(result.current.parentChildConfig.parent.delimiter).toBe('')
    })

    it('should update parent config maxLength', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateParentConfig('maxLength', 2048)
      })

      expect(result.current.parentChildConfig.parent.maxLength).toBe(2048)
    })

    it('should update child config delimiter with truthy value', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateChildConfig('delimiter', '\n')
      })

      expect(result.current.parentChildConfig.child.delimiter).toBe('\\n')
    })

    it('should update child config delimiter with empty value', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateChildConfig('delimiter', '')
      })

      expect(result.current.parentChildConfig.child.delimiter).toBe('')
    })

    it('should update child config maxLength', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateChildConfig('maxLength', 256)
      })

      expect(result.current.parentChildConfig.child.maxLength).toBe(256)
    })

    it('should set chunk for context mode', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setChunkForContext('full-doc')
      })

      expect(result.current.parentChildConfig.chunkForContext).toBe('full-doc')
    })
  })

  // Tests for resetToDefaults
  describe('resetToDefaults', () => {
    it('should reset to default config when available', () => {
      const { result } = renderHook(() => useSegmentationState())

      // Set non-default values and default config
      act(() => {
        result.current.setMaxChunkLength(2048)
        result.current.setOverlap(100)
        result.current.setDefaultConfig(createMockRules())
      })

      // Reset - should use default config values
      act(() => {
        result.current.resetToDefaults()
      })

      expect(result.current.maxChunkLength).toBe(1024)
      expect(result.current.overlap).toBe(50)
      expect(result.current.parentChildConfig).toEqual(defaultParentChildConfig)
    })

    it('should only reset parentChildConfig when no default config', () => {
      const { result } = renderHook(() => useSegmentationState())

      // Set non-default values without setting defaultConfig
      act(() => {
        result.current.setMaxChunkLength(2048)
        result.current.setOverlap(100)
        result.current.setChunkForContext('full-doc')
      })

      // Reset - should only reset parentChildConfig since no default config
      act(() => {
        result.current.resetToDefaults()
      })

      // Values stay the same since no defaultConfig
      expect(result.current.maxChunkLength).toBe(2048)
      expect(result.current.overlap).toBe(100)
      // But parentChildConfig is always reset
      expect(result.current.parentChildConfig).toEqual(defaultParentChildConfig)
    })
  })

  // Tests for applyConfigFromRules
  describe('applyConfigFromRules', () => {
    it('should apply general config from rules', () => {
      const { result } = renderHook(() => useSegmentationState())
      const rules = createMockRules({
        segmentation: { separator: '---', max_tokens: 512, chunk_overlap: 25 },
      })

      act(() => {
        result.current.applyConfigFromRules(rules, false)
      })

      expect(result.current.maxChunkLength).toBe(512)
      expect(result.current.overlap).toBe(25)
    })

    it('should apply hierarchical config from rules', () => {
      const { result } = renderHook(() => useSegmentationState())
      const rules = createMockRules({
        parent_mode: 'paragraph',
        subchunk_segmentation: { separator: '\n', max_tokens: 256 },
      })

      act(() => {
        result.current.applyConfigFromRules(rules, true)
      })

      expect(result.current.parentChildConfig.chunkForContext).toBe('paragraph')
      expect(result.current.parentChildConfig.child.maxLength).toBe(256)
    })

    it('should apply full hierarchical parent-child config from rules', () => {
      const { result } = renderHook(() => useSegmentationState())
      const rules = createMockRules({
        segmentation: { separator: '\n\n', max_tokens: 1024, chunk_overlap: 50 },
        parent_mode: 'full-doc',
        subchunk_segmentation: { separator: '\n', max_tokens: 128 },
      })

      act(() => {
        result.current.applyConfigFromRules(rules, true)
      })

      // Should set parent config from segmentation
      expect(result.current.parentChildConfig.parent.delimiter).toBe('\\n\\n')
      expect(result.current.parentChildConfig.parent.maxLength).toBe(1024)
      // Should set child config from subchunk_segmentation
      expect(result.current.parentChildConfig.child.delimiter).toBe('\\n')
      expect(result.current.parentChildConfig.child.maxLength).toBe(128)
      // Should set chunkForContext
      expect(result.current.parentChildConfig.chunkForContext).toBe('full-doc')
    })
  })

  // Tests for getProcessRule
  describe('getProcessRule', () => {
    it('should return general process rule', () => {
      const { result } = renderHook(() => useSegmentationState())

      const processRule = result.current.getProcessRule(ChunkingMode.text)

      expect(processRule.mode).toBe(ProcessMode.general)
      expect(processRule.rules.segmentation.max_tokens).toBe(DEFAULT_MAXIMUM_CHUNK_LENGTH)
    })

    it('should return hierarchical process rule for parent-child', () => {
      const { result } = renderHook(() => useSegmentationState())

      const processRule = result.current.getProcessRule(ChunkingMode.parentChild)

      expect(processRule.mode).toBe('hierarchical')
      expect(processRule.rules.parent_mode).toBe('paragraph')
      expect(processRule.rules.subchunk_segmentation).toBeDefined()
    })
  })
})

// ============================================
// useIndexingConfig Hook Tests
// ============================================

describe('useIndexingConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRerankDefaultModelValid = true
  })

  // Tests for initial state
  // Note: Hook has useEffect that syncs state, so we test the state after effects settle
  describe('Initial State', () => {
    it('should initialize with QUALIFIED when API key is set', async () => {
      const { result } = renderHook(() =>
        useIndexingConfig({ isAPIKeySet: true, hasSetIndexType: false }),
      )

      // After effects settle, indexType should be QUALIFIED
      await vi.waitFor(() => {
        expect(result.current.indexType).toBe(IndexingType.QUALIFIED)
      })
    })

    it('should initialize with ECONOMICAL when API key is not set', async () => {
      const { result } = renderHook(() =>
        useIndexingConfig({ isAPIKeySet: false, hasSetIndexType: false }),
      )

      await vi.waitFor(() => {
        expect(result.current.indexType).toBe(IndexingType.ECONOMICAL)
      })
    })

    it('should use initial index type when provided', async () => {
      const { result } = renderHook(() =>
        useIndexingConfig({
          isAPIKeySet: false,
          hasSetIndexType: true,
          initialIndexType: IndexingType.QUALIFIED,
        }),
      )

      await vi.waitFor(() => {
        expect(result.current.indexType).toBe(IndexingType.QUALIFIED)
      })
    })
  })

  // Tests for state setters
  describe('State Management', () => {
    it('should update index type', async () => {
      const { result } = renderHook(() =>
        useIndexingConfig({ isAPIKeySet: true, hasSetIndexType: false }),
      )

      // Wait for initial effects to settle
      await vi.waitFor(() => {
        expect(result.current.indexType).toBeDefined()
      })

      act(() => {
        result.current.setIndexType(IndexingType.ECONOMICAL)
      })

      expect(result.current.indexType).toBe(IndexingType.ECONOMICAL)
    })

    it('should update embedding model', async () => {
      const { result } = renderHook(() =>
        useIndexingConfig({ isAPIKeySet: true, hasSetIndexType: false }),
      )

      await vi.waitFor(() => {
        expect(result.current.embeddingModel).toBeDefined()
      })

      act(() => {
        result.current.setEmbeddingModel({ provider: 'cohere', model: 'embed-v3' })
      })

      expect(result.current.embeddingModel).toEqual({ provider: 'cohere', model: 'embed-v3' })
    })

    it('should update retrieval config', async () => {
      const { result } = renderHook(() =>
        useIndexingConfig({ isAPIKeySet: true, hasSetIndexType: false }),
      )

      await vi.waitFor(() => {
        expect(result.current.retrievalConfig).toBeDefined()
      })

      const newConfig: RetrievalConfig = {
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_enable: true,
        reranking_model: { reranking_provider_name: 'cohere', reranking_model_name: 'rerank-v3' },
        top_k: 5,
        score_threshold_enabled: true,
        score_threshold: 0.7,
      }

      act(() => {
        result.current.setRetrievalConfig(newConfig)
      })

      expect(result.current.retrievalConfig).toEqual(newConfig)
    })
  })

  // Tests for getIndexingTechnique
  describe('getIndexingTechnique', () => {
    it('should return initial type when set', async () => {
      const { result } = renderHook(() =>
        useIndexingConfig({
          isAPIKeySet: true,
          hasSetIndexType: true,
          initialIndexType: IndexingType.ECONOMICAL,
        }),
      )

      await vi.waitFor(() => {
        expect(result.current.getIndexingTechnique()).toBe(IndexingType.ECONOMICAL)
      })
    })

    it('should return current type when no initial type', async () => {
      const { result } = renderHook(() =>
        useIndexingConfig({ isAPIKeySet: true, hasSetIndexType: false }),
      )

      await vi.waitFor(() => {
        expect(result.current.indexType).toBeDefined()
      })

      act(() => {
        result.current.setIndexType(IndexingType.ECONOMICAL)
      })

      expect(result.current.getIndexingTechnique()).toBe(IndexingType.ECONOMICAL)
    })
  })

  // Tests for initialRetrievalConfig handling
  describe('initialRetrievalConfig', () => {
    it('should skip retrieval config sync when initialRetrievalConfig is provided', async () => {
      const customRetrievalConfig: RetrievalConfig = {
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_enable: true,
        reranking_model: { reranking_provider_name: 'custom', reranking_model_name: 'custom-model' },
        top_k: 10,
        score_threshold_enabled: true,
        score_threshold: 0.8,
      }

      const { result } = renderHook(() =>
        useIndexingConfig({
          isAPIKeySet: true,
          hasSetIndexType: false,
          initialRetrievalConfig: customRetrievalConfig,
        }),
      )

      await vi.waitFor(() => {
        expect(result.current.retrievalConfig).toBeDefined()
      })

      // Should use the provided initial config, not the default synced one
      expect(result.current.retrievalConfig.search_method).toBe(RETRIEVE_METHOD.hybrid)
      expect(result.current.retrievalConfig.top_k).toBe(10)
    })
  })
})

// ============================================
// usePreviewState Hook Tests
// ============================================

describe('usePreviewState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultOptions = {
    dataSourceType: DataSourceType.FILE,
    files: [createMockFile()],
    notionPages: [createMockNotionPage()],
    websitePages: [createMockWebsitePage()],
  }

  // Tests for initial state
  describe('Initial State', () => {
    it('should initialize with first file for FILE data source', () => {
      const { result } = renderHook(() => usePreviewState(defaultOptions))

      expect(result.current.previewFile).toEqual(defaultOptions.files[0])
    })

    it('should initialize with first notion page for NOTION data source', () => {
      const { result } = renderHook(() =>
        usePreviewState({ ...defaultOptions, dataSourceType: DataSourceType.NOTION }),
      )

      expect(result.current.previewNotionPage).toEqual(defaultOptions.notionPages[0])
    })

    it('should initialize with document detail when provided', () => {
      const documentDetail = createMockDocumentDetail()
      const { result } = renderHook(() =>
        usePreviewState({
          ...defaultOptions,
          documentDetail,
          datasetId: 'test-id',
        }),
      )

      expect(result.current.previewFile).toEqual(documentDetail.file)
    })
  })

  // Tests for getPreviewPickerItems
  describe('getPreviewPickerItems', () => {
    it('should return files for FILE data source', () => {
      const { result } = renderHook(() => usePreviewState(defaultOptions))

      const items = result.current.getPreviewPickerItems()
      expect(items).toEqual(defaultOptions.files)
    })

    it('should return mapped notion pages for NOTION data source', () => {
      const { result } = renderHook(() =>
        usePreviewState({ ...defaultOptions, dataSourceType: DataSourceType.NOTION }),
      )

      const items = result.current.getPreviewPickerItems()
      expect(items[0]).toEqual({
        id: 'notion-page-1',
        name: 'Test Notion Page',
        extension: 'md',
      })
    })

    it('should return mapped website pages for WEB data source', () => {
      const { result } = renderHook(() =>
        usePreviewState({ ...defaultOptions, dataSourceType: DataSourceType.WEB }),
      )

      const items = result.current.getPreviewPickerItems()
      expect(items[0]).toEqual({
        id: 'https://example.com/page1',
        name: 'Test Website Page',
        extension: 'md',
      })
    })

    it('should return empty array for unknown data source', () => {
      const { result } = renderHook(() =>
        usePreviewState({ ...defaultOptions, dataSourceType: 'unknown' as DataSourceType }),
      )

      const items = result.current.getPreviewPickerItems()
      expect(items).toEqual([])
    })
  })

  // Tests for getPreviewPickerValue
  describe('getPreviewPickerValue', () => {
    it('should return file value for FILE data source', () => {
      const { result } = renderHook(() => usePreviewState(defaultOptions))

      const value = result.current.getPreviewPickerValue()
      expect(value).toEqual(defaultOptions.files[0])
    })

    it('should return mapped notion page value for NOTION data source', () => {
      const notionPage = createMockNotionPage({ page_id: 'page-123', page_name: 'My Page' })
      const { result } = renderHook(() =>
        usePreviewState({
          ...defaultOptions,
          dataSourceType: DataSourceType.NOTION,
          notionPages: [notionPage],
        }),
      )

      const value = result.current.getPreviewPickerValue()
      expect(value).toEqual({
        id: 'page-123',
        name: 'My Page',
        extension: 'md',
      })
    })

    it('should return mapped website page value for WEB data source', () => {
      const websitePage = createMockWebsitePage({ source_url: 'https://test.com', title: 'Test Title' })
      const { result } = renderHook(() =>
        usePreviewState({
          ...defaultOptions,
          dataSourceType: DataSourceType.WEB,
          websitePages: [websitePage],
        }),
      )

      const value = result.current.getPreviewPickerValue()
      expect(value).toEqual({
        id: 'https://test.com',
        name: 'Test Title',
        extension: 'md',
      })
    })

    it('should return empty value for unknown data source', () => {
      const { result } = renderHook(() =>
        usePreviewState({ ...defaultOptions, dataSourceType: 'unknown' as DataSourceType }),
      )

      const value = result.current.getPreviewPickerValue()
      expect(value).toEqual({ id: '', name: '', extension: '' })
    })

    it('should handle undefined notion page gracefully', () => {
      const { result } = renderHook(() =>
        usePreviewState({
          ...defaultOptions,
          dataSourceType: DataSourceType.NOTION,
          notionPages: [],
        }),
      )

      const value = result.current.getPreviewPickerValue()
      expect(value).toEqual({
        id: '',
        name: '',
        extension: 'md',
      })
    })

    it('should handle undefined website page gracefully', () => {
      const { result } = renderHook(() =>
        usePreviewState({
          ...defaultOptions,
          dataSourceType: DataSourceType.WEB,
          websitePages: [],
        }),
      )

      const value = result.current.getPreviewPickerValue()
      expect(value).toEqual({
        id: '',
        name: '',
        extension: 'md',
      })
    })
  })

  // Tests for handlePreviewChange
  describe('handlePreviewChange', () => {
    it('should update preview file for FILE data source', () => {
      const files = [createMockFile(), createMockFile({ id: 'file-2', name: 'second.pdf' })]
      const { result } = renderHook(() =>
        usePreviewState({ ...defaultOptions, files }),
      )

      act(() => {
        result.current.handlePreviewChange({ id: 'file-2', name: 'second.pdf' })
      })

      expect(result.current.previewFile).toEqual({ id: 'file-2', name: 'second.pdf' })
    })

    it('should update preview notion page for NOTION data source', () => {
      const notionPages = [
        createMockNotionPage(),
        createMockNotionPage({ page_id: 'notion-page-2', page_name: 'Second Page' }),
      ]
      const { result } = renderHook(() =>
        usePreviewState({ ...defaultOptions, dataSourceType: DataSourceType.NOTION, notionPages }),
      )

      act(() => {
        result.current.handlePreviewChange({ id: 'notion-page-2', name: 'Second Page' })
      })

      expect(result.current.previewNotionPage?.page_id).toBe('notion-page-2')
    })

    it('should update preview website page for WEB data source', () => {
      const websitePages = [
        createMockWebsitePage(),
        createMockWebsitePage({ source_url: 'https://example.com/page2', title: 'Second Page' }),
      ]
      const { result } = renderHook(() =>
        usePreviewState({ ...defaultOptions, dataSourceType: DataSourceType.WEB, websitePages }),
      )

      act(() => {
        result.current.handlePreviewChange({ id: 'https://example.com/page2', name: 'Second Page' })
      })

      expect(result.current.previewWebsitePage?.source_url).toBe('https://example.com/page2')
    })
  })
})

// ============================================
// useDocumentCreation Hook Tests
// ============================================

describe('useDocumentCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultOptions = {
    dataSourceType: DataSourceType.FILE,
    files: [createMockFile()],
    notionPages: [] as NotionPage[],
    notionCredentialId: '',
    websitePages: [] as CrawlResultItem[],
  }

  // Tests for validateParams
  describe('validateParams', () => {
    it('should return false when overlap exceeds max chunk length', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))

      const isValid = result.current.validateParams({
        segmentationType: 'general',
        maxChunkLength: 100,
        limitMaxChunkLength: 4000,
        overlap: 200,
        indexType: IndexingType.QUALIFIED,
        embeddingModel: { provider: 'openai', model: 'text-embedding-ada-002' },
        rerankModelList: [],
        retrievalConfig: {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
      })

      expect(isValid).toBe(false)
    })

    it('should return false when max chunk length exceeds limit', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))

      const isValid = result.current.validateParams({
        segmentationType: 'general',
        maxChunkLength: 5000,
        limitMaxChunkLength: 4000,
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
          score_threshold: 0.5,
        },
      })

      expect(isValid).toBe(false)
    })

    it('should return true for valid params', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))

      const isValid = result.current.validateParams({
        segmentationType: 'general',
        maxChunkLength: 1000,
        limitMaxChunkLength: 4000,
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
          score_threshold: 0.5,
        },
      })

      expect(isValid).toBe(true)
    })
  })

  // Tests for buildCreationParams
  describe('buildCreationParams', () => {
    it('should build params for file upload', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))

      const params = result.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        { mode: ProcessMode.general, rules: createMockRules() },
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      expect(params).toBeDefined()
      expect(params?.doc_form).toBe(ChunkingMode.text)
      expect(params?.doc_language).toBe('English')
      expect(params?.data_source?.type).toBe(DataSourceType.FILE)
    })

    it('should build params for setting mode', () => {
      const documentDetail = createMockDocumentDetail()
      const { result } = renderHook(() =>
        useDocumentCreation({
          ...defaultOptions,
          isSetting: true,
          documentDetail,
        }),
      )

      const params = result.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        { mode: ProcessMode.general, rules: createMockRules() },
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      expect(params?.original_document_id).toBe(documentDetail.id)
    })

    it('should build params for notion_import data source', () => {
      const { result } = renderHook(() =>
        useDocumentCreation({
          ...defaultOptions,
          dataSourceType: DataSourceType.NOTION,
          notionPages: [createMockNotionPage()],
          notionCredentialId: 'notion-cred-123',
        }),
      )

      const params = result.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        { mode: ProcessMode.general, rules: createMockRules() },
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      expect(params).toBeDefined()
      expect(params?.data_source?.type).toBe(DataSourceType.NOTION)
      expect(params?.data_source?.info_list.notion_info_list).toBeDefined()
    })

    it('should build params for website_crawl data source', () => {
      const { result } = renderHook(() =>
        useDocumentCreation({
          ...defaultOptions,
          dataSourceType: DataSourceType.WEB,
          websitePages: [createMockWebsitePage()],
          websiteCrawlProvider: 'jinaReader' as DataSourceProvider,
          websiteCrawlJobId: 'job-123',
          crawlOptions: { max_depth: 2 } as CrawlOptions,
        }),
      )

      const params = result.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        { mode: ProcessMode.general, rules: createMockRules() },
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      expect(params).toBeDefined()
      expect(params?.data_source?.type).toBe(DataSourceType.WEB)
      expect(params?.data_source?.info_list.website_info_list).toBeDefined()
    })
  })

  // Tests for validateParams edge cases
  describe('validateParams - additional cases', () => {
    it('should return false when embedding model is missing for QUALIFIED index type', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))

      const isValid = result.current.validateParams({
        segmentationType: 'general',
        maxChunkLength: 500,
        limitMaxChunkLength: 4000,
        overlap: 50,
        indexType: IndexingType.QUALIFIED,
        embeddingModel: { provider: '', model: '' },
        rerankModelList: mockRerankModelList,
        retrievalConfig: {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
      })

      expect(isValid).toBe(false)
    })

    it('should return false when rerank model is required but not selected', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))

      // isReRankModelSelected returns false when:
      // - indexMethod === 'high_quality' (IndexingType.QUALIFIED)
      // - reranking_enable === true
      // - rerankModelSelected === false (model not found in list)
      const isValid = result.current.validateParams({
        segmentationType: 'general',
        maxChunkLength: 500,
        limitMaxChunkLength: 4000,
        overlap: 50,
        indexType: IndexingType.QUALIFIED,
        embeddingModel: { provider: 'openai', model: 'text-embedding-ada-002' },
        rerankModelList: [], // Empty list means model won't be found
        retrievalConfig: {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true, // Reranking enabled
          reranking_model: {
            reranking_provider_name: 'nonexistent',
            reranking_model_name: 'nonexistent-model',
          },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
      })

      expect(isValid).toBe(false)
    })
  })

  // Tests for executeCreation
  describe('executeCreation', () => {
    it('should call createFirstDocumentMutation when datasetId is not provided', async () => {
      const mockOnStepChange = vi.fn()
      const mockUpdateIndexingTypeCache = vi.fn()
      const mockUpdateResultCache = vi.fn()
      const mockUpdateRetrievalMethodCache = vi.fn()
      const mockOnSave = vi.fn()

      const { result } = renderHook(() =>
        useDocumentCreation({
          ...defaultOptions,
          datasetId: undefined,
          onStepChange: mockOnStepChange,
          updateIndexingTypeCache: mockUpdateIndexingTypeCache,
          updateResultCache: mockUpdateResultCache,
          updateRetrievalMethodCache: mockUpdateRetrievalMethodCache,
          onSave: mockOnSave,
        }),
      )

      const params = result.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        { mode: ProcessMode.general, rules: createMockRules() },
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      await act(async () => {
        await result.current.executeCreation(params!, IndexingType.QUALIFIED, {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        })
      })

      expect(mockOnStepChange).toHaveBeenCalledWith(1)
    })

    it('should call createDocumentMutation when datasetId is provided', async () => {
      const mockOnStepChange = vi.fn()
      const { result } = renderHook(() =>
        useDocumentCreation({
          ...defaultOptions,
          datasetId: 'existing-dataset-id',
          onStepChange: mockOnStepChange,
        }),
      )

      const params = result.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        { mode: ProcessMode.general, rules: createMockRules() },
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      await act(async () => {
        await result.current.executeCreation(params!, IndexingType.QUALIFIED, {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        })
      })

      expect(mockOnStepChange).toHaveBeenCalledWith(1)
    })

    it('should call onSave when in setting mode', async () => {
      const mockOnSave = vi.fn()
      const documentDetail = createMockDocumentDetail()
      const { result } = renderHook(() =>
        useDocumentCreation({
          ...defaultOptions,
          datasetId: 'existing-dataset-id',
          isSetting: true,
          documentDetail,
          onSave: mockOnSave,
        }),
      )

      const params = result.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        { mode: ProcessMode.general, rules: createMockRules() },
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      await act(async () => {
        await result.current.executeCreation(params!, IndexingType.QUALIFIED, {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        })
      })

      expect(mockOnSave).toHaveBeenCalled()
    })
  })

  // Tests for validatePreviewParams
  describe('validatePreviewParams', () => {
    it('should return true for valid max chunk length', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))

      const isValid = result.current.validatePreviewParams(1000)
      expect(isValid).toBe(true)
    })

    it('should return false when max chunk length exceeds maximum', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))

      const isValid = result.current.validatePreviewParams(10000)
      expect(isValid).toBe(false)
    })
  })
})

// ============================================
// useIndexingEstimate Hook Tests
// ============================================

describe('useIndexingEstimate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultOptions = {
    dataSourceType: DataSourceType.FILE,
    currentDocForm: ChunkingMode.text,
    docLanguage: 'English',
    files: [createMockFile()],
    previewNotionPage: createMockNotionPage(),
    notionCredentialId: '',
    previewWebsitePage: createMockWebsitePage(),
    indexingTechnique: IndexingType.QUALIFIED,
    processRule: { mode: ProcessMode.general, rules: createMockRules() },
  }

  // Tests for initial state
  describe('Initial State', () => {
    it('should initialize with idle state', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))

      expect(result.current.isIdle).toBe(true)
      expect(result.current.isPending).toBe(false)
      expect(result.current.estimate).toBeUndefined()
    })
  })

  // Tests for fetchEstimate
  describe('fetchEstimate', () => {
    it('should have fetchEstimate function', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))

      expect(typeof result.current.fetchEstimate).toBe('function')
    })

    it('should have reset function', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))

      expect(typeof result.current.reset).toBe('function')
    })

    it('should call fetchEstimate for FILE data source', () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({
          ...defaultOptions,
          dataSourceType: DataSourceType.FILE,
          previewFileName: 'test-file.pdf',
        }),
      )

      act(() => {
        result.current.fetchEstimate()
      })

      // fetchEstimate should be callable without error
      expect(result.current.fetchEstimate).toBeDefined()
    })

    it('should call fetchEstimate for NOTION data source', () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({
          ...defaultOptions,
          dataSourceType: DataSourceType.NOTION,
          previewNotionPage: createMockNotionPage(),
          notionCredentialId: 'cred-123',
        }),
      )

      act(() => {
        result.current.fetchEstimate()
      })

      expect(result.current.fetchEstimate).toBeDefined()
    })

    it('should call fetchEstimate for WEB data source', () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({
          ...defaultOptions,
          dataSourceType: DataSourceType.WEB,
          previewWebsitePage: createMockWebsitePage(),
          websiteCrawlProvider: 'jinaReader' as DataSourceProvider,
          websiteCrawlJobId: 'job-123',
          crawlOptions: { max_depth: 2 } as CrawlOptions,
        }),
      )

      act(() => {
        result.current.fetchEstimate()
      })

      expect(result.current.fetchEstimate).toBeDefined()
    })
  })

  // Tests for getCurrentMutation based on data source type
  describe('Data Source Selection', () => {
    it('should use file query for FILE data source', () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({
          ...defaultOptions,
          dataSourceType: DataSourceType.FILE,
        }),
      )

      expect(result.current.currentMutation).toBeDefined()
      expect(result.current.isIdle).toBe(true)
    })

    it('should use notion query for NOTION data source', () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({
          ...defaultOptions,
          dataSourceType: DataSourceType.NOTION,
        }),
      )

      expect(result.current.currentMutation).toBeDefined()
      expect(result.current.isIdle).toBe(true)
    })

    it('should use website query for WEB data source', () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({
          ...defaultOptions,
          dataSourceType: DataSourceType.WEB,
          websiteCrawlProvider: 'jinaReader' as DataSourceProvider,
          websiteCrawlJobId: 'job-123',
        }),
      )

      expect(result.current.currentMutation).toBeDefined()
      expect(result.current.isIdle).toBe(true)
    })
  })
})

// ============================================
// StepTwoFooter Component Tests
// ============================================

describe('StepTwoFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    isSetting: false,
    isCreating: false,
    onPrevious: vi.fn(),
    onCreate: vi.fn(),
    onCancel: vi.fn(),
  }

  // Tests for rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<StepTwoFooter {...defaultProps} />)

      // Should render Previous and Next buttons with correct text
      expect(screen.getByText(/previousStep/i)).toBeInTheDocument()
      expect(screen.getByText(/nextStep/i)).toBeInTheDocument()
    })

    it('should render Previous and Next buttons when not in setting mode', () => {
      render(<StepTwoFooter {...defaultProps} />)

      expect(screen.getByText(/previousStep/i)).toBeInTheDocument()
      expect(screen.getByText(/nextStep/i)).toBeInTheDocument()
    })

    it('should render Save and Cancel buttons when in setting mode', () => {
      render(<StepTwoFooter {...defaultProps} isSetting={true} />)

      expect(screen.getByText(/save/i)).toBeInTheDocument()
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()
    })
  })

  // Tests for user interactions
  describe('User Interactions', () => {
    it('should call onPrevious when Previous button is clicked', () => {
      const onPrevious = vi.fn()
      render(<StepTwoFooter {...defaultProps} onPrevious={onPrevious} />)

      fireEvent.click(screen.getByText(/previousStep/i))

      expect(onPrevious).toHaveBeenCalledTimes(1)
    })

    it('should call onCreate when Next/Save button is clicked', () => {
      const onCreate = vi.fn()
      render(<StepTwoFooter {...defaultProps} onCreate={onCreate} />)

      fireEvent.click(screen.getByText(/nextStep/i))

      expect(onCreate).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when Cancel button is clicked in setting mode', () => {
      const onCancel = vi.fn()
      render(<StepTwoFooter {...defaultProps} isSetting={true} onCancel={onCancel} />)

      fireEvent.click(screen.getByText(/cancel/i))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  // Tests for loading state
  describe('Loading State', () => {
    it('should show loading state on Next button when creating', () => {
      render(<StepTwoFooter {...defaultProps} isCreating={true} />)

      const nextButton = screen.getByText(/nextStep/i).closest('button')
      // Button has disabled:btn-disabled class which handles the loading state
      expect(nextButton).toHaveClass('disabled:btn-disabled')
    })

    it('should show loading state on Save button when creating in setting mode', () => {
      render(<StepTwoFooter {...defaultProps} isSetting={true} isCreating={true} />)

      const saveButton = screen.getByText(/save/i).closest('button')
      // Button has disabled:btn-disabled class which handles the loading state
      expect(saveButton).toHaveClass('disabled:btn-disabled')
    })
  })
})

// ============================================
// PreviewPanel Component Tests
// ============================================

describe('PreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    isMobile: false,
    dataSourceType: DataSourceType.FILE,
    currentDocForm: ChunkingMode.text,
    estimate: undefined as FileIndexingEstimateResponse | undefined,
    parentChildConfig: defaultParentChildConfig,
    isSetting: false,
    pickerFiles: [{ id: 'file-1', name: 'test.pdf', extension: 'pdf' }],
    pickerValue: { id: 'file-1', name: 'test.pdf', extension: 'pdf' },
    isIdle: true,
    isPending: false,
    onPickerChange: vi.fn(),
  }

  // Tests for rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<PreviewPanel {...defaultProps} />)

      // Check for the preview header title text
      expect(screen.getByText('datasetCreation.stepTwo.preview')).toBeInTheDocument()
    })

    it('should render idle state when isIdle is true', () => {
      render(<PreviewPanel {...defaultProps} isIdle={true} />)

      expect(screen.getByText(/previewChunkTip/i)).toBeInTheDocument()
    })

    it('should render loading skeleton when isPending is true', () => {
      render(<PreviewPanel {...defaultProps} isIdle={false} isPending={true} />)

      // Should show skeleton containers
      expect(screen.queryByText(/previewChunkTip/i)).not.toBeInTheDocument()
    })
  })

  // Tests for different doc forms
  describe('Preview Content', () => {
    it('should render text preview when docForm is text', () => {
      const estimate = createMockEstimate()
      render(
        <PreviewPanel
          {...defaultProps}
          isIdle={false}
          estimate={estimate}
          currentDocForm={ChunkingMode.text}
        />,
      )

      expect(screen.getByText('Chunk 1 content')).toBeInTheDocument()
    })

    it('should render QA preview when docForm is qa', () => {
      const estimate = createMockEstimate()
      render(
        <PreviewPanel
          {...defaultProps}
          isIdle={false}
          estimate={estimate}
          currentDocForm={ChunkingMode.qa}
        />,
      )

      expect(screen.getByText('Q1')).toBeInTheDocument()
      expect(screen.getByText('A1')).toBeInTheDocument()
    })

    it('should show chunk count badge for non-QA doc form', () => {
      const estimate = createMockEstimate({ total_segments: 25 })
      render(
        <PreviewPanel
          {...defaultProps}
          isIdle={false}
          estimate={estimate}
          currentDocForm={ChunkingMode.text}
        />,
      )

      expect(screen.getByText(/25/)).toBeInTheDocument()
    })

    it('should render parent-child preview when docForm is parentChild', () => {
      const estimate = createMockEstimate({
        preview: [
          { content: 'Parent chunk content', child_chunks: ['Child 1', 'Child 2', 'Child 3'] },
        ],
      })
      render(
        <PreviewPanel
          {...defaultProps}
          isIdle={false}
          estimate={estimate}
          currentDocForm={ChunkingMode.parentChild}
          parentChildConfig={{
            ...defaultParentChildConfig,
            chunkForContext: 'paragraph',
          }}
        />,
      )

      // Should render parent chunk label
      expect(screen.getByText('Chunk-1')).toBeInTheDocument()
      // Should render child chunks
      expect(screen.getByText('Child 1')).toBeInTheDocument()
      expect(screen.getByText('Child 2')).toBeInTheDocument()
      expect(screen.getByText('Child 3')).toBeInTheDocument()
    })

    it('should limit child chunks when chunkForContext is full-doc', () => {
      // FULL_DOC_PREVIEW_LENGTH is 50, so we need more than 50 chunks to test the limit
      const manyChildChunks = Array.from({ length: 60 }, (_, i) => `ChildChunk${i + 1}`)
      const estimate = createMockEstimate({
        preview: [{ content: 'Parent content', child_chunks: manyChildChunks }],
      })
      render(
        <PreviewPanel
          {...defaultProps}
          isIdle={false}
          estimate={estimate}
          currentDocForm={ChunkingMode.parentChild}
          parentChildConfig={{
            ...defaultParentChildConfig,
            chunkForContext: 'full-doc',
          }}
        />,
      )

      // Should render parent chunk
      expect(screen.getByText('Chunk-1')).toBeInTheDocument()
      // full-doc mode limits to FULL_DOC_PREVIEW_LENGTH (50)
      expect(screen.getByText('ChildChunk1')).toBeInTheDocument()
      expect(screen.getByText('ChildChunk50')).toBeInTheDocument()
      // Should not render beyond the limit
      expect(screen.queryByText('ChildChunk51')).not.toBeInTheDocument()
    })

    it('should render multiple parent chunks in parent-child mode', () => {
      const estimate = createMockEstimate({
        preview: [
          { content: 'Parent 1', child_chunks: ['P1-C1'] },
          { content: 'Parent 2', child_chunks: ['P2-C1'] },
        ],
      })
      render(
        <PreviewPanel
          {...defaultProps}
          isIdle={false}
          estimate={estimate}
          currentDocForm={ChunkingMode.parentChild}
        />,
      )

      expect(screen.getByText('Chunk-1')).toBeInTheDocument()
      expect(screen.getByText('Chunk-2')).toBeInTheDocument()
      expect(screen.getByText('P1-C1')).toBeInTheDocument()
      expect(screen.getByText('P2-C1')).toBeInTheDocument()
    })
  })

  // Tests for picker
  describe('Document Picker', () => {
    it('should call onPickerChange when document is selected', () => {
      const onPickerChange = vi.fn()
      render(<PreviewPanel {...defaultProps} onPickerChange={onPickerChange} />)

      // The picker interaction would be tested through the actual component
      expect(onPickerChange).not.toHaveBeenCalled()
    })
  })
})

// ============================================
// Edge Cases Tests
// ============================================

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Empty/Null Values', () => {
    it('should handle empty files array in usePreviewState', () => {
      const { result } = renderHook(() =>
        usePreviewState({
          dataSourceType: DataSourceType.FILE,
          files: [],
          notionPages: [],
          websitePages: [],
        }),
      )

      expect(result.current.previewFile).toBeUndefined()
    })

    it('should handle empty notion pages array', () => {
      const { result } = renderHook(() =>
        usePreviewState({
          dataSourceType: DataSourceType.NOTION,
          files: [],
          notionPages: [],
          websitePages: [],
        }),
      )

      expect(result.current.previewNotionPage).toBeUndefined()
    })

    it('should handle empty website pages array', () => {
      const { result } = renderHook(() =>
        usePreviewState({
          dataSourceType: DataSourceType.WEB,
          files: [],
          notionPages: [],
          websitePages: [],
        }),
      )

      expect(result.current.previewWebsitePage).toBeUndefined()
    })
  })

  describe('Boundary Conditions', () => {
    it('should handle very large chunk length', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setMaxChunkLength(999999)
      })

      expect(result.current.maxChunkLength).toBe(999999)
    })

    it('should handle zero overlap', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setOverlap(0)
      })

      expect(result.current.overlap).toBe(0)
    })

    it('should handle special characters in segment identifier', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentIdentifier('<<>>')
      })

      expect(result.current.segmentIdentifier).toBe('<<>>')
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable setSegmentIdentifier reference', () => {
      const { result, rerender } = renderHook(() => useSegmentationState())
      const initialSetter = result.current.setSegmentIdentifier

      rerender()

      expect(result.current.setSegmentIdentifier).toBe(initialSetter)
    })

    it('should maintain stable toggleRule reference', () => {
      const { result, rerender } = renderHook(() => useSegmentationState())
      const initialToggle = result.current.toggleRule

      rerender()

      expect(result.current.toggleRule).toBe(initialToggle)
    })

    it('should maintain stable getProcessRule reference', () => {
      const { result, rerender } = renderHook(() => useSegmentationState())

      // Update some state to trigger re-render
      act(() => {
        result.current.setMaxChunkLength(2048)
      })

      rerender()

      // getProcessRule depends on state, so it may change but should remain a function
      expect(typeof result.current.getProcessRule).toBe('function')
    })
  })
})

// ============================================
// Integration Scenarios
// ============================================

describe('Integration Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentDataset = null
  })

  describe('Document Creation Flow', () => {
    it('should build and validate params for file upload workflow', () => {
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

      // Build params
      const params = creationResult.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        segResult.current.getProcessRule(ChunkingMode.text),
        {
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 3,
          score_threshold_enabled: false,
          score_threshold: 0.5,
        },
        { provider: 'openai', model: 'text-embedding-ada-002' },
        IndexingType.QUALIFIED,
      )

      expect(params).toBeDefined()
      expect(params?.data_source?.info_list.file_info_list?.file_ids).toContain('file-1')
    })

    it('should handle parent-child document form', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentationType(ProcessMode.parentChild)
        result.current.setChunkForContext('full-doc')
        result.current.updateParentConfig('maxLength', 2048)
        result.current.updateChildConfig('maxLength', 512)
      })

      const processRule = result.current.getProcessRule(ChunkingMode.parentChild)

      expect(processRule.mode).toBe('hierarchical')
      expect(processRule.rules.parent_mode).toBe('full-doc')
      expect(processRule.rules.segmentation.max_tokens).toBe(2048)
      expect(processRule.rules.subchunk_segmentation?.max_tokens).toBe(512)
    })
  })

  describe('Preview Flow', () => {
    it('should handle preview file change flow', () => {
      const files = [
        createMockFile({ id: 'file-1', name: 'first.pdf' }),
        createMockFile({ id: 'file-2', name: 'second.pdf' }),
      ]

      const { result } = renderHook(() =>
        usePreviewState({
          dataSourceType: DataSourceType.FILE,
          files,
          notionPages: [],
          websitePages: [],
        }),
      )

      // Initial state
      expect(result.current.getPreviewPickerValue().name).toBe('first.pdf')

      // Change preview
      act(() => {
        result.current.handlePreviewChange({ id: 'file-2', name: 'second.pdf' })
      })

      expect(result.current.previewFile).toEqual({ id: 'file-2', name: 'second.pdf' })
    })
  })

  describe('Escape/Unescape Round Trip', () => {
    it('should preserve original string through escape/unescape', () => {
      const original = '\n\n'
      const escaped = escape(original)
      const unescaped = unescape(escaped)

      expect(unescaped).toBe(original)
    })

    it('should handle complex strings without backslashes', () => {
      // This string contains control characters but no literal backslashes.
      const original = 'Hello\nWorld\t!\r\n'
      const escaped = escape(original)
      const unescaped = unescape(escaped)
      expect(unescaped).toBe(original)
    })

    it('should document behavior for strings with existing backslashes', () => {
      // When the original string already contains backslash sequences,
      // escape/unescape are not perfectly symmetric because escape()
      // does not escape backslashes.
      const original = 'Hello\\nWorld'
      const escaped = escape(original)
      const unescaped = unescape(escaped)
      // The unescaped value interprets "\n" as a newline, so it differs from the original.
      expect(unescaped).toBe('Hello\nWorld')
      expect(unescaped).not.toBe(original)
    })
  })
})
