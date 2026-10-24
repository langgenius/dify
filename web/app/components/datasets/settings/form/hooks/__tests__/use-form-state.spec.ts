import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { RetrievalConfig } from '@/types/app'
import { zProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { QueryClient } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  ChunkingMode,
  DataSourceType,
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { updateDatasetSetting } from '@/service/datasets'
import { createCatalogModelFixture, createModelCatalogFixture } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderHook as renderHookWithConsoleState } from '@/test/console/render'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
import { IndexingType } from '../../../../create/step-two'
import { useFormState } from '../use-form-state'

const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
const datasetListKey = consoleQuery.datasets.get.key()

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

// Mock contexts
const mockMutateDatasets = vi.fn()

const renderHook = (callback: () => ReturnType<typeof useFormState>) => {
  const { queryClient, wrapper } = createConsoleQueryWrapper({ accountProfile: { id: 'user-1' } })
  for (const modelType of [ModelTypeEnum.rerank, ModelTypeEnum.textEmbedding]) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type: modelType } },
      }),
      {
        data: [
          zProviderWithModelsResponse.parse(
            createModelCatalogFixture({
              provider: 'langgenius/xinference/xinference',
              models: [
                createCatalogModelFixture({
                  model: 'bge-reranker-v2-m3',
                  model_type: modelType,
                  features: [],
                }),
              ],
            }),
          ),
        ],
      },
    )
  }
  queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
    accounts: [
      {
        id: 'user-1',
        name: 'User 1',
        email: 'user1@example.com',
        role: 'owner',
        avatar: '',
        avatar_url: '',
        last_login_at: 0,
        created_at: 0,
        status: 'active',
      },
      {
        id: 'user-2',
        name: 'User 2',
        email: 'user2@example.com',
        role: 'admin',
        avatar: '',
        avatar_url: '',
        last_login_at: 0,
        created_at: 0,
        status: 'active',
      },
    ],
  })
  return renderHookWithConsoleState(callback, { wrapper })
}

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
  }))
})
vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')

  return createSystemFeaturesStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
  }))
})

const createDefaultMockDataset = (): DatasetDetailWithPartialMembersResponse => ({
  ...createDatasetFixture(),
  id: 'dataset-1',
  name: 'Test Dataset',
  description: 'Test description',
  permission: PermissionLevel.onlyMe,
  icon_info: {
    icon_type: 'emoji',
    icon: '📚',
    icon_background: '#FFFFFF',
    icon_url: '',
  },
  indexing_technique: IndexingType.QUALIFIED,
  data_source_type: DataSourceType.FILE,
  doc_form: ChunkingMode.text,
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  embedding_available: true,
  app_count: 0,
  document_count: 5,
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
  built_in_field_enabled: false,
  keyword_number: 10,
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 1700000000,
  runtime_mode: 'general',
  enable_api: true,
  is_multimodal: false,
  permission_keys: [DatasetACLPermission.Edit],
})

let mockDataset: DatasetDetailWithPartialMembersResponse = createDefaultMockDataset()

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: {
      dataset: DatasetDetailWithPartialMembersResponse | null
      mutateDatasetRes: () => void
    }) => unknown,
  ) => {
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

vi.mock('@/app/notifications', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

describe('useFormState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDefaultMockDataset()
    vi.mocked(updateDatasetSetting).mockReset().mockResolvedValue(mockDataset)
  })

  describe('Icon Handlers', () => {
    it('persists the selected emoji icon', async () => {
      const { result } = renderHook(() => useFormState(mockDataset))

      act(() => {
        result.current.handleSelectAppIcon({
          type: 'emoji',
          icon: '🎉',
          background: '#FF0000',
        })
      })

      await act(async () => result.current.handleSave())
      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          icon_info: {
            icon_type: 'emoji',
            icon: '🎉',
            icon_background: '#FF0000',
            icon_url: undefined,
          },
        }),
      })
    })

    it('persists the uploaded image icon', async () => {
      const { result } = renderHook(() => useFormState(mockDataset))

      act(() => {
        result.current.handleSelectAppIcon({
          type: 'image',
          fileId: 'file-123',
          url: 'https://example.com/icon.png',
        })
      })

      await act(async () => result.current.handleSave())
      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          icon_info: {
            icon_type: 'image',
            icon: 'file-123',
            icon_background: undefined,
            icon_url: 'https://example.com/icon.png',
          },
        }),
      })
    })
  })

  describe('Summary Index Setting Handler', () => {
    it('persists merged summary settings after separate edits', async () => {
      const { result } = renderHook(() => useFormState(mockDataset))

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

      await act(async () => result.current.handleSave())
      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          summary_index_setting: expect.objectContaining({
            enable: true,
            model_provider_name: 'openai',
            model_name: 'gpt-4',
          }),
        }),
      })
    })
  })

  describe('handleSave', () => {
    it('should mark the name invalid when it is empty', async () => {
      const { toast } = await import('@/app/notifications')
      const { result } = renderHook(() => useFormState(mockDataset))

      act(() => {
        result.current.setName('')
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(result.current.nameInvalid).toBe(true)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('should mark the name invalid when it is whitespace only', async () => {
      const { toast } = await import('@/app/notifications')
      const { result } = renderHook(() => useFormState(mockDataset))

      act(() => {
        result.current.setName('   ')
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(result.current.nameInvalid).toBe(true)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('should call updateDatasetSetting with correct params', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState(mockDataset))

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          name: 'Test Dataset',
          description: 'Test description',
          permission: PermissionLevel.onlyMe,
        }),
      })
      expect(mockMutateDatasets).toHaveBeenCalledTimes(1)
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: datasetListKey })
    })

    it('should not save when dataset only has readonly ACL permission', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      mockDataset = {
        ...createDefaultMockDataset(),
        permission_keys: [DatasetACLPermission.Readonly],
      }
      const { result } = renderHook(() => useFormState(mockDataset))

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).not.toHaveBeenCalled()
    })

    it('should show error toast on save failure', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { toast } = await import('@/app/notifications')
      vi.mocked(updateDatasetSetting).mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useFormState(mockDataset))

      await act(async () => {
        await result.current.handleSave()
      })

      expect(toast.error).toHaveBeenCalledWith(expect.any(String))
    })

    it('should include partial_member_list when permission is partialMembers', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState(mockDataset))

      act(() => {
        result.current.setPermission(PermissionLevel.partialMembers)
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

  describe('Retrieval Config', () => {
    it('should include weights in save request when weights are set', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState(mockDataset))

      // Set retrieval config with weights
      const configWithWeights: RetrievalConfig = {
        ...result.current.retrievalConfig,
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_mode: RerankingModeEnum.WeightedScore,
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

    it('should send the configured score threshold when score_threshold_enabled is true', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState(mockDataset))

      act(() => {
        result.current.setRetrievalConfig({
          ...result.current.retrievalConfig,
          score_threshold_enabled: true,
          score_threshold: 0.62,
        })
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          retrieval_model: expect.objectContaining({
            score_threshold_enabled: true,
            score_threshold: 0.62,
          }),
        }),
      })
    })
  })

  describe('Hybrid Search reranking_enable derivation', () => {
    const hybridConfigWithRerankModel = (
      base: RetrievalConfig,
      rerankingEnable: boolean,
    ): RetrievalConfig => ({
      ...base,
      search_method: RETRIEVE_METHOD.hybrid,
      reranking_enable: rerankingEnable,
      reranking_mode: RerankingModeEnum.RerankingModel,
      reranking_model: {
        reranking_provider_name: 'langgenius/xinference/xinference',
        reranking_model_name: 'bge-reranker-v2-m3',
      },
    })

    it('should persist reranking_enable=true when a rerank model is configured but the stale flag is false', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState(mockDataset))

      // Reproduces the reported bug: Hybrid Search renders no rerank switch, so the flag keeps
      // the stale `false` default even though a rerank model is selected.
      act(() => {
        result.current.setRetrievalConfig(
          hybridConfigWithRerankModel(result.current.retrievalConfig, false),
        )
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          retrieval_model: expect.objectContaining({
            search_method: RETRIEVE_METHOD.hybrid,
            reranking_enable: true,
          }),
        }),
      })
    })

    it('should leave reranking_enable untouched when Hybrid Search uses weighted score', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState(mockDataset))

      act(() => {
        result.current.setRetrievalConfig({
          ...hybridConfigWithRerankModel(result.current.retrievalConfig, false),
          reranking_mode: RerankingModeEnum.WeightedScore,
        })
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          retrieval_model: expect.objectContaining({
            reranking_enable: false,
          }),
        }),
      })
    })

    it('should leave reranking_enable untouched for semantic search', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      const { result } = renderHook(() => useFormState(mockDataset))

      act(() => {
        result.current.setRetrievalConfig({
          ...hybridConfigWithRerankModel(result.current.retrievalConfig, false),
          search_method: RETRIEVE_METHOD.semantic,
        })
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          retrieval_model: expect.objectContaining({
            reranking_enable: false,
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
      const { result } = renderHook(() => useFormState(mockDataset))

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
      const { result } = renderHook(() => useFormState(mockDataset))

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
