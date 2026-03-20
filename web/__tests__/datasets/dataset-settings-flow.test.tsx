/**
 * Integration Test: Dataset Settings Flow
 *
 * Tests cross-module data contracts in the dataset settings form:
 *   useFormState hook ↔ index method config ↔ retrieval config ↔ permission state.
 *
 * The unit-level use-form-state.spec.ts validates the hook in isolation.
 * This integration test verifies that changing one configuration dimension
 * correctly cascades to dependent parts (index method → retrieval config,
 * permission → member list visibility, embedding model → embedding available state).
 */

import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { act, renderHook, waitFor } from '@testing-library/react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType, WeightedScoreEnum } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'

// --- Mocks ---

const mockMutateDatasets = vi.fn()
const mockInvalidDatasetList = vi.fn()
const mockUpdateDatasetSetting = vi.fn().mockResolvedValue({})

vi.mock('@/context/app-context', () => ({
  useSelector: () => false,
}))

vi.mock('@/service/datasets', () => ({
  updateDatasetSetting: (...args: unknown[]) => mockUpdateDatasetSetting(...args),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'user-1', name: 'Alice', email: 'alice@example.com', role: 'owner', avatar: '', avatar_url: '', last_login_at: '', created_at: '', status: 'active' },
        { id: 'user-2', name: 'Bob', email: 'bob@example.com', role: 'admin', avatar: '', avatar_url: '', last_login_at: '', created_at: '', status: 'active' },
        { id: 'user-3', name: 'Charlie', email: 'charlie@example.com', role: 'normal', avatar: '', avatar_url: '', last_login_at: '', created_at: '', status: 'active' },
      ],
    },
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: () => ({ data: [] }),
}))

vi.mock('@/app/components/datasets/common/check-rerank-model', () => ({
  isReRankModelSelected: () => true,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

// --- Dataset factory ---

const createMockDataset = (overrides?: Partial<DataSet>): DataSet => ({
  id: 'ds-settings-1',
  name: 'Settings Test Dataset',
  description: 'Integration test dataset',
  permission: DatasetPermission.onlyMe,
  icon_info: {
    icon_type: 'emoji',
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_url: '',
  },
  indexing_technique: 'high_quality',
  indexing_status: 'completed',
  data_source_type: DataSourceType.FILE,
  doc_form: ChunkingMode.text,
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  embedding_available: true,
  app_count: 2,
  document_count: 10,
  total_document_count: 10,
  word_count: 5000,
  provider: 'vendor',
  tags: [],
  partial_member_list: [],
  external_knowledge_info: {
    external_knowledge_id: '',
    external_knowledge_api_id: '',
    external_knowledge_api_name: '',
    external_knowledge_api_endpoint: '',
  },
  external_retrieval_model: {
    top_k: 2,
    score_threshold: 0.5,
    score_threshold_enabled: false,
  },
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0,
  } as RetrievalConfig,
  retrieval_model: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0,
  } as RetrievalConfig,
  built_in_field_enabled: false,
  keyword_number: 10,
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: Date.now(),
  runtime_mode: 'general',
  enable_api: true,
  is_multimodal: false,
  ...overrides,
} as DataSet)

let mockDataset: DataSet = createMockDataset()

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: DataSet | null, mutateDatasetRes: () => void }) => unknown,
  ) => selector({ dataset: mockDataset, mutateDatasetRes: mockMutateDatasets }),
}))

// Import after mocks are registered
const { useFormState } = await import(
  '@/app/components/datasets/settings/form/hooks/use-form-state',
)

describe('Dataset Settings Flow - Cross-Module Configuration Cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDatasetSetting.mockResolvedValue({})
    mockDataset = createMockDataset()
  })

  describe('Form State Initialization from Dataset → Index Method → Retrieval Config Chain', () => {
    it('should initialise all form dimensions from a QUALIFIED dataset', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.name).toBe('Settings Test Dataset')
      expect(result.current.description).toBe('Integration test dataset')
      expect(result.current.indexMethod).toBe('high_quality')
      expect(result.current.embeddingModel).toEqual({
        provider: 'openai',
        model: 'text-embedding-ada-002',
      })
      expect(result.current.retrievalConfig.search_method).toBe(RETRIEVE_METHOD.semantic)
    })

    it('should initialise from an ECONOMICAL dataset with keyword retrieval', () => {
      mockDataset = createMockDataset({
        indexing_technique: IndexingType.ECONOMICAL,
        embedding_model: '',
        embedding_model_provider: '',
        retrieval_model_dict: {
          search_method: RETRIEVE_METHOD.keywordSearch,
          reranking_enable: false,
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 5,
          score_threshold_enabled: false,
          score_threshold: 0,
        } as RetrievalConfig,
      })

      const { result } = renderHook(() => useFormState())

      expect(result.current.indexMethod).toBe(IndexingType.ECONOMICAL)
      expect(result.current.embeddingModel).toEqual({ provider: '', model: '' })
      expect(result.current.retrievalConfig.search_method).toBe(RETRIEVE_METHOD.keywordSearch)
    })
  })

  describe('Index Method Change → Retrieval Config Sync', () => {
    it('should allow switching index method from QUALIFIED to ECONOMICAL', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.indexMethod).toBe('high_quality')

      act(() => {
        result.current.setIndexMethod(IndexingType.ECONOMICAL)
      })

      expect(result.current.indexMethod).toBe(IndexingType.ECONOMICAL)
    })

    it('should allow updating retrieval config after index method switch', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setIndexMethod(IndexingType.ECONOMICAL)
      })

      act(() => {
        result.current.setRetrievalConfig({
          ...result.current.retrievalConfig,
          search_method: RETRIEVE_METHOD.keywordSearch,
          reranking_enable: false,
        })
      })

      expect(result.current.indexMethod).toBe(IndexingType.ECONOMICAL)
      expect(result.current.retrievalConfig.search_method).toBe(RETRIEVE_METHOD.keywordSearch)
      expect(result.current.retrievalConfig.reranking_enable).toBe(false)
    })

    it('should preserve retrieval config when switching back to QUALIFIED', () => {
      const { result } = renderHook(() => useFormState())

      const originalConfig = { ...result.current.retrievalConfig }

      act(() => {
        result.current.setIndexMethod(IndexingType.ECONOMICAL)
      })
      act(() => {
        result.current.setIndexMethod(IndexingType.QUALIFIED)
      })

      expect(result.current.indexMethod).toBe('high_quality')
      expect(result.current.retrievalConfig.search_method).toBe(originalConfig.search_method)
    })
  })

  describe('Permission Change → Member List Visibility Logic', () => {
    it('should start with onlyMe permission and empty member selection', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.permission).toBe(DatasetPermission.onlyMe)
      expect(result.current.selectedMemberIDs).toEqual([])
    })

    it('should enable member selection when switching to partialMembers', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setPermission(DatasetPermission.partialMembers)
      })

      expect(result.current.permission).toBe(DatasetPermission.partialMembers)
      expect(result.current.memberList).toHaveLength(3)
      expect(result.current.memberList.map(m => m.id)).toEqual(['user-1', 'user-2', 'user-3'])
    })

    it('should persist member selection through permission toggle', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setPermission(DatasetPermission.partialMembers)
        result.current.setSelectedMemberIDs(['user-1', 'user-3'])
      })

      act(() => {
        result.current.setPermission(DatasetPermission.allTeamMembers)
      })

      act(() => {
        result.current.setPermission(DatasetPermission.partialMembers)
      })

      expect(result.current.selectedMemberIDs).toEqual(['user-1', 'user-3'])
    })

    it('should include partial_member_list in save payload only for partialMembers', async () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setPermission(DatasetPermission.partialMembers)
        result.current.setSelectedMemberIDs(['user-2'])
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'ds-settings-1',
        body: expect.objectContaining({
          permission: DatasetPermission.partialMembers,
          partial_member_list: [
            expect.objectContaining({ user_id: 'user-2', role: 'admin' }),
          ],
        }),
      })
    })

    it('should not include partial_member_list for allTeamMembers permission', async () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setPermission(DatasetPermission.allTeamMembers)
      })

      await act(async () => {
        await result.current.handleSave()
      })

      const savedBody = mockUpdateDatasetSetting.mock.calls[0][0].body as Record<string, unknown>
      expect(savedBody).not.toHaveProperty('partial_member_list')
    })
  })

  describe('Form Submission Validation → All Fields Together', () => {
    it('should reject empty name on save', async () => {
      const Toast = await import('@/app/components/base/toast')
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setName('')
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(Toast.default.notify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
      expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
    })

    it('should include all configuration dimensions in a successful save', async () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setName('Updated Name')
        result.current.setDescription('Updated Description')
        result.current.setIndexMethod(IndexingType.ECONOMICAL)
        result.current.setKeywordNumber(15)
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'ds-settings-1',
        body: expect.objectContaining({
          name: 'Updated Name',
          description: 'Updated Description',
          indexing_technique: 'economy',
          keyword_number: 15,
          embedding_model: 'text-embedding-ada-002',
          embedding_model_provider: 'openai',
        }),
      })
    })

    it('should call mutateDatasets and invalidDatasetList after successful save', async () => {
      const { result } = renderHook(() => useFormState())

      await act(async () => {
        await result.current.handleSave()
      })

      await waitFor(() => {
        expect(mockMutateDatasets).toHaveBeenCalled()
        expect(mockInvalidDatasetList).toHaveBeenCalled()
      })
    })
  })

  describe('Embedding Model Change → Retrieval Config Cascade', () => {
    it('should update embedding model independently of retrieval config', () => {
      const { result } = renderHook(() => useFormState())

      const originalRetrievalConfig = { ...result.current.retrievalConfig }

      act(() => {
        result.current.setEmbeddingModel({ provider: 'cohere', model: 'embed-english-v3.0' })
      })

      expect(result.current.embeddingModel).toEqual({
        provider: 'cohere',
        model: 'embed-english-v3.0',
      })
      expect(result.current.retrievalConfig.search_method).toBe(originalRetrievalConfig.search_method)
    })

    it('should propagate embedding model into weighted retrieval config on save', async () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setEmbeddingModel({ provider: 'cohere', model: 'embed-v3' })
        result.current.setRetrievalConfig({
          ...result.current.retrievalConfig,
          search_method: RETRIEVE_METHOD.hybrid,
          weights: {
            weight_type: WeightedScoreEnum.Customized,
            vector_setting: {
              vector_weight: 0.6,
              embedding_provider_name: '',
              embedding_model_name: '',
            },
            keyword_setting: { keyword_weight: 0.4 },
          },
        })
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'ds-settings-1',
        body: expect.objectContaining({
          embedding_model: 'embed-v3',
          embedding_model_provider: 'cohere',
          retrieval_model: expect.objectContaining({
            weights: expect.objectContaining({
              vector_setting: expect.objectContaining({
                embedding_provider_name: 'cohere',
                embedding_model_name: 'embed-v3',
              }),
            }),
          }),
        }),
      })
    })

    it('should handle switching from semantic to hybrid search with embedding model', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setRetrievalConfig({
          ...result.current.retrievalConfig,
          search_method: RETRIEVE_METHOD.hybrid,
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: 'cohere',
            reranking_model_name: 'rerank-english-v3.0',
          },
        })
      })

      expect(result.current.retrievalConfig.search_method).toBe(RETRIEVE_METHOD.hybrid)
      expect(result.current.retrievalConfig.reranking_enable).toBe(true)
      expect(result.current.embeddingModel.model).toBe('text-embedding-ada-002')
    })
  })
})
