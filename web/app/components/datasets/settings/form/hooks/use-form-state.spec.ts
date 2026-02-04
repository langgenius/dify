import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ChunkingMode, DatasetPermission, DataSourceType, WeightedScoreEnum } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../create/step-two'
import { useFormState } from './use-form-state'

// Mock contexts
const mockMutateDatasets = vi.fn()
const mockInvalidDatasetList = vi.fn()

vi.mock('@/context/app-context', () => ({
  useSelector: () => false, // isCurrentWorkspaceDatasetOperator
}))

const createDefaultMockDataset = (): DataSet => ({
  id: 'dataset-1',
  name: 'Test Dataset',
  description: 'Test description',
  permission: DatasetPermission.onlyMe,
  icon_info: {
    icon_type: 'emoji',
    icon: '📚',
    icon_background: '#FFFFFF',
    icon_url: '',
  },
  indexing_technique: IndexingType.QUALIFIED,
  indexing_status: 'completed',
  data_source_type: DataSourceType.FILE,
  doc_form: ChunkingMode.text,
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  embedding_available: true,
  app_count: 0,
  document_count: 5,
  total_document_count: 5,
  word_count: 1000,
  provider: 'vendor',
  tags: [],
  partial_member_list: [],
  external_knowledge_info: {
    external_knowledge_id: 'ext-1',
    external_knowledge_api_id: 'api-1',
    external_knowledge_api_name: 'External API',
    external_knowledge_api_endpoint: 'https://api.example.com',
  },
  external_retrieval_model: {
    top_k: 3,
    score_threshold: 0.7,
    score_threshold_enabled: true,
  },
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  } as RetrievalConfig,
  retrieval_model: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  } as RetrievalConfig,
  built_in_field_enabled: false,
  keyword_number: 10,
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: Date.now(),
  runtime_mode: 'general',
  enable_api: true,
  is_multimodal: false,
})

let mockDataset: DataSet = createDefaultMockDataset()

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: DataSet | null, mutateDatasetRes: () => void }) => unknown) => {
    const state = {
      dataset: mockDataset,
      mutateDatasetRes: mockMutateDatasets,
    }
    return selector(state)
  },
}))

// Mock services
vi.mock('@/service/datasets', () => ({
  updateDatasetSetting: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'user-1', name: 'User 1', email: 'user1@example.com', role: 'owner', avatar: '', avatar_url: '', last_login_at: '', created_at: '', status: 'active' },
        { id: 'user-2', name: 'User 2', email: 'user2@example.com', role: 'admin', avatar: '', avatar_url: '', last_login_at: '', created_at: '', status: 'active' },
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
  default: {
    notify: vi.fn(),
  },
}))

describe('useFormState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDefaultMockDataset()
  })

  describe('Initial State', () => {
    it('should initialize with dataset values', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.name).toBe('Test Dataset')
      expect(result.current.description).toBe('Test description')
      expect(result.current.permission).toBe(DatasetPermission.onlyMe)
      expect(result.current.indexMethod).toBe(IndexingType.QUALIFIED)
      expect(result.current.keywordNumber).toBe(10)
    })

    it('should initialize icon info from dataset', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.iconInfo).toEqual({
        icon_type: 'emoji',
        icon: '📚',
        icon_background: '#FFFFFF',
        icon_url: '',
      })
    })

    it('should initialize external retrieval settings', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.topK).toBe(3)
      expect(result.current.scoreThreshold).toBe(0.7)
      expect(result.current.scoreThresholdEnabled).toBe(true)
    })

    it('should derive member list from API data', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.memberList).toHaveLength(2)
      expect(result.current.memberList[0].name).toBe('User 1')
    })

    it('should return currentDataset from context', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.currentDataset).toBeDefined()
      expect(result.current.currentDataset?.id).toBe('dataset-1')
    })
  })

  describe('State Setters', () => {
    it('should update name when setName is called', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setName('New Name')
      })

      expect(result.current.name).toBe('New Name')
    })

    it('should update description when setDescription is called', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setDescription('New Description')
      })

      expect(result.current.description).toBe('New Description')
    })

    it('should update permission when setPermission is called', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setPermission(DatasetPermission.allTeamMembers)
      })

      expect(result.current.permission).toBe(DatasetPermission.allTeamMembers)
    })

    it('should update indexMethod when setIndexMethod is called', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setIndexMethod(IndexingType.ECONOMICAL)
      })

      expect(result.current.indexMethod).toBe(IndexingType.ECONOMICAL)
    })

    it('should update keywordNumber when setKeywordNumber is called', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setKeywordNumber(20)
      })

      expect(result.current.keywordNumber).toBe(20)
    })

    it('should update selectedMemberIDs when setSelectedMemberIDs is called', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setSelectedMemberIDs(['user-1', 'user-2'])
      })

      expect(result.current.selectedMemberIDs).toEqual(['user-1', 'user-2'])
    })
  })

  describe('Icon Handlers', () => {
    it('should open app icon picker and save previous icon', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleOpenAppIconPicker()
      })

      expect(result.current.showAppIconPicker).toBe(true)
    })

    it('should select emoji icon and close picker', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleOpenAppIconPicker()
      })

      act(() => {
        result.current.handleSelectAppIcon({
          type: 'emoji',
          icon: '🎉',
          background: '#FF0000',
        })
      })

      expect(result.current.showAppIconPicker).toBe(false)
      expect(result.current.iconInfo).toEqual({
        icon_type: 'emoji',
        icon: '🎉',
        icon_background: '#FF0000',
        icon_url: undefined,
      })
    })

    it('should select image icon and close picker', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleOpenAppIconPicker()
      })

      act(() => {
        result.current.handleSelectAppIcon({
          type: 'image',
          fileId: 'file-123',
          url: 'https://example.com/icon.png',
        })
      })

      expect(result.current.showAppIconPicker).toBe(false)
      expect(result.current.iconInfo).toEqual({
        icon_type: 'image',
        icon: 'file-123',
        icon_background: undefined,
        icon_url: 'https://example.com/icon.png',
      })
    })

    it('should restore previous icon when picker is closed', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleOpenAppIconPicker()
      })

      act(() => {
        result.current.handleSelectAppIcon({
          type: 'emoji',
          icon: '🎉',
          background: '#FF0000',
        })
      })

      act(() => {
        result.current.handleOpenAppIconPicker()
      })

      act(() => {
        result.current.handleCloseAppIconPicker()
      })

      expect(result.current.showAppIconPicker).toBe(false)
      // After close, icon should be restored to the icon before opening
      expect(result.current.iconInfo).toEqual({
        icon_type: 'emoji',
        icon: '🎉',
        icon_background: '#FF0000',
        icon_url: undefined,
      })
    })
  })

  describe('External Retrieval Settings Handler', () => {
    it('should update topK when provided', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleSettingsChange({ top_k: 5 })
      })

      expect(result.current.topK).toBe(5)
    })

    it('should update scoreThreshold when provided', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleSettingsChange({ score_threshold: 0.8 })
      })

      expect(result.current.scoreThreshold).toBe(0.8)
    })

    it('should update scoreThresholdEnabled when provided', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleSettingsChange({ score_threshold_enabled: false })
      })

      expect(result.current.scoreThresholdEnabled).toBe(false)
    })

    it('should update multiple settings at once', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleSettingsChange({
          top_k: 10,
          score_threshold: 0.9,
          score_threshold_enabled: true,
        })
      })

      expect(result.current.topK).toBe(10)
      expect(result.current.scoreThreshold).toBe(0.9)
      expect(result.current.scoreThresholdEnabled).toBe(true)
    })
  })

  describe('Summary Index Setting Handler', () => {
    it('should update summary index setting', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleSummaryIndexSettingChange({
          enable: true,
        })
      })

      expect(result.current.summaryIndexSetting).toMatchObject({
        enable: true,
      })
    })

    it('should merge with existing settings', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.handleSummaryIndexSettingChange({
          enable: true,
        })
      })

      act(() => {
        result.current.handleSummaryIndexSettingChange({
          model_provider_name: 'openai',
          model_name: 'gpt-4',
        })
      })

      expect(result.current.summaryIndexSetting).toMatchObject({
        enable: true,
        model_provider_name: 'openai',
        model_name: 'gpt-4',
      })
    })
  })

  describe('handleSave', () => {
    it('should show error toast when name is empty', async () => {
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
    })

    it('should show error toast when name is whitespace only', async () => {
      const Toast = await import('@/app/components/base/toast')
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setName('   ')
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(Toast.default.notify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
    })

    it('should call updateDatasetSetting with correct params', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState())

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          name: 'Test Dataset',
          description: 'Test description',
          permission: DatasetPermission.onlyMe,
        }),
      })
    })

    it('should show success toast on successful save', async () => {
      const Toast = await import('@/app/components/base/toast')
      const { result } = renderHook(() => useFormState())

      await act(async () => {
        await result.current.handleSave()
      })

      await waitFor(() => {
        expect(Toast.default.notify).toHaveBeenCalledWith({
          type: 'success',
          message: expect.any(String),
        })
      })
    })

    it('should call mutateDatasets after successful save', async () => {
      const { result } = renderHook(() => useFormState())

      await act(async () => {
        await result.current.handleSave()
      })

      await waitFor(() => {
        expect(mockMutateDatasets).toHaveBeenCalled()
      })
    })

    it('should call invalidDatasetList after successful save', async () => {
      const { result } = renderHook(() => useFormState())

      await act(async () => {
        await result.current.handleSave()
      })

      await waitFor(() => {
        expect(mockInvalidDatasetList).toHaveBeenCalled()
      })
    })

    it('should set loading to true during save', async () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.loading).toBe(false)

      const savePromise = act(async () => {
        await result.current.handleSave()
      })

      // Loading should be true during the save operation
      await savePromise

      expect(result.current.loading).toBe(false) // After completion
    })

    it('should not save when already loading', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      vi.mocked(updateDatasetSetting).mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      const { result } = renderHook(() => useFormState())

      // Start first save
      act(() => {
        result.current.handleSave()
      })

      // Try to start second save immediately
      await act(async () => {
        await result.current.handleSave()
      })

      // Should only have been called once
      expect(updateDatasetSetting).toHaveBeenCalledTimes(1)
    })

    it('should show error toast on save failure', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const Toast = await import('@/app/components/base/toast')
      vi.mocked(updateDatasetSetting).mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useFormState())

      await act(async () => {
        await result.current.handleSave()
      })

      expect(Toast.default.notify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
    })

    it('should include partial_member_list when permission is partialMembers', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setPermission(DatasetPermission.partialMembers)
        result.current.setSelectedMemberIDs(['user-1', 'user-2'])
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          partial_member_list: expect.arrayContaining([
            expect.objectContaining({ user_id: 'user-1' }),
            expect.objectContaining({ user_id: 'user-2' }),
          ]),
        }),
      })
    })
  })

  describe('Embedding Model', () => {
    it('should initialize embedding model from dataset', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.embeddingModel).toEqual({
        provider: 'openai',
        model: 'text-embedding-ada-002',
      })
    })

    it('should update embedding model when setEmbeddingModel is called', () => {
      const { result } = renderHook(() => useFormState())

      act(() => {
        result.current.setEmbeddingModel({
          provider: 'cohere',
          model: 'embed-english-v3.0',
        })
      })

      expect(result.current.embeddingModel).toEqual({
        provider: 'cohere',
        model: 'embed-english-v3.0',
      })
    })
  })

  describe('Retrieval Config', () => {
    it('should initialize retrieval config from dataset', () => {
      const { result } = renderHook(() => useFormState())

      expect(result.current.retrievalConfig).toBeDefined()
      expect(result.current.retrievalConfig.search_method).toBe(RETRIEVE_METHOD.semantic)
    })

    it('should update retrieval config when setRetrievalConfig is called', () => {
      const { result } = renderHook(() => useFormState())

      const newConfig: RetrievalConfig = {
        ...result.current.retrievalConfig,
        reranking_enable: true,
      }

      act(() => {
        result.current.setRetrievalConfig(newConfig)
      })

      expect(result.current.retrievalConfig.reranking_enable).toBe(true)
    })

    it('should include weights in save request when weights are set', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState())

      // Set retrieval config with weights
      const configWithWeights: RetrievalConfig = {
        ...result.current.retrievalConfig,
        search_method: RETRIEVE_METHOD.hybrid,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.7,
            embedding_provider_name: '',
            embedding_model_name: '',
          },
          keyword_setting: {
            keyword_weight: 0.3,
          },
        },
      }

      act(() => {
        result.current.setRetrievalConfig(configWithWeights)
      })

      await act(async () => {
        await result.current.handleSave()
      })

      // Verify that weights were included and embedding model info was added
      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          retrieval_model: expect.objectContaining({
            weights: expect.objectContaining({
              vector_setting: expect.objectContaining({
                embedding_provider_name: 'openai',
                embedding_model_name: 'text-embedding-ada-002',
              }),
            }),
          }),
        }),
      })
    })
  })

  describe('External Provider', () => {
    beforeEach(() => {
      // Update mock dataset to be external provider
      mockDataset = {
        ...mockDataset,
        provider: 'external',
        external_knowledge_info: {
          external_knowledge_id: 'ext-123',
          external_knowledge_api_id: 'api-456',
          external_knowledge_api_name: 'External API',
          external_knowledge_api_endpoint: 'https://api.example.com',
        },
        external_retrieval_model: {
          top_k: 5,
          score_threshold: 0.8,
          score_threshold_enabled: true,
        },
      }
    })

    it('should include external knowledge info in save request for external provider', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState())

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          external_knowledge_id: 'ext-123',
          external_knowledge_api_id: 'api-456',
          external_retrieval_model: expect.objectContaining({
            top_k: expect.any(Number),
            score_threshold: expect.any(Number),
            score_threshold_enabled: expect.any(Boolean),
          }),
        }),
      })
    })

    it('should use correct external retrieval settings', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState())

      // Update external retrieval settings
      act(() => {
        result.current.handleSettingsChange({
          top_k: 10,
          score_threshold: 0.9,
          score_threshold_enabled: false,
        })
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          external_retrieval_model: {
            top_k: 10,
            score_threshold: 0.9,
            score_threshold_enabled: false,
          },
        }),
      })
    })
  })
})
