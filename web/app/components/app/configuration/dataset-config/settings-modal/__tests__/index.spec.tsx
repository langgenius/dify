import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { MockedFunction } from 'vite-plus/test'
import type { RetrievalConfig } from '@/types/app'
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { ChunkingMode, DataSourceType, RerankingModeEnum } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { updateDatasetSetting } from '@/service/datasets'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { renderWithConsoleQuery as renderWithoutUrlState } from '@/test/console/query-data'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { RETRIEVE_METHOD } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
import SettingsModal from '../index'

const { mockMembersQuery } = vi.hoisted(() => ({
  mockMembersQuery: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: Object.assign(toastMocks.call, {
    success: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'success', message, ...options }),
    ),
    error: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'error', message, ...options }),
    ),
    warning: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'warning', message, ...options }),
    ),
    info: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'info', message, ...options }),
    ),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))
const mockOnCancel = vi.fn()
const mockOnSave = vi.fn()

const mockModelListQuery = vi.fn()

vi.mock('@/service/datasets', () => ({
  updateDatasetSetting: vi.fn(),
}))

vi.mock('@/context/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/i18n')>()),
  useDocLink: () => (path: string) => `https://docs${path}`,
}))

const mockUpdateDatasetSetting = updateDatasetSetting as MockedFunction<typeof updateDatasetSetting>
const mockUseMembers = mockMembersQuery as MockedFunction<typeof mockMembersQuery>

const createRetrievalConfig = (overrides: Partial<RetrievalConfig> = {}): RetrievalConfig => ({
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  top_k: 2,
  score_threshold_enabled: false,
  score_threshold: 0.5,
  reranking_mode: RerankingModeEnum.RerankingModel,
  ...overrides,
})

const createDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
  retrievalOverrides: Partial<RetrievalConfig> = {},
): DatasetDetailWithPartialMembersResponse => {
  const retrievalConfig = createRetrievalConfig(retrievalOverrides)
  return {
    ...createDatasetFixture(),
    id: 'dataset-id',
    name: 'Test Dataset',
    icon_info: {
      icon: 'icon',
      icon_type: 'emoji',
    },
    description: 'Description',
    permission: PermissionLevel.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    author_name: 'Author',
    created_by: 'creator',
    updated_by: 'updater',
    updated_at: 1700000000,
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 0,
    total_available_documents: 0,
    word_count: 0,
    provider: 'internal',
    embedding_model: 'embed-model',
    embedding_model_provider: 'embed-provider',
    embedding_available: true,
    tags: [],
    partial_member_list: [],
    external_knowledge_info: {
      external_knowledge_id: 'ext-id',
      external_knowledge_api_id: 'ext-api-id',
      external_knowledge_api_name: 'External API',
      external_knowledge_api_endpoint: 'https://api.example.com',
    },
    external_retrieval_model: {
      top_k: 2,
      score_threshold: 0.5,
      score_threshold_enabled: false,
    },
    built_in_field_enabled: false,
    doc_metadata: [],
    keyword_number: 10,
    pipeline_id: 'pipeline-id',
    is_published: false,
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
    permission_keys: [DatasetACLPermission.Edit],
    ...overrides,
    retrieval_model_dict: {
      ...retrievalConfig,
      ...overrides.retrieval_model_dict,
    },
  }
}

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithoutUrlState, () => ({ onUrlUpdate }))

const renderWithProviders = (dataset: DatasetDetailWithPartialMembersResponse) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  queryClient.setQueryData(systemFeaturesQueryOptions().queryKey, createSystemFeaturesFixture())
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryOptions().queryKey, {
    retrieval_method: [RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.fullText, RETRIEVE_METHOD.hybrid],
  })

  queryClient.setQueryData(
    consoleQuery.workspaces.current.members.get.queryOptions({ input: {} }).queryKey,
    mockUseMembers().data,
  )
  seedModelProviderQueries(
    queryClient,
    [ModelTypeEnum.textEmbedding, ModelTypeEnum.rerank].flatMap(
      (type) => mockModelListQuery(type).data,
    ),
  )
  return render(
    <SettingsModal currentDataset={dataset} onCancel={mockOnCancel} onSave={mockOnSave} />,
    { queryClient },
  )
}

const createMemberList = (): DatasetDetailWithPartialMembersResponse['partial_member_list'] => [
  'member-2',
]

const renderSettingsModal = async (dataset: DatasetDetailWithPartialMembersResponse) => {
  renderWithProviders(dataset)
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMembers.mockReturnValue({
      data: {
        accounts: [
          {
            id: 'user-1',
            name: 'User One',
            email: 'user@example.com',
            avatar: 'avatar.png',
            avatar_url: 'avatar.png',
            status: 'active',
            role: 'owner',
          },
          {
            id: 'member-2',
            name: 'Member Two',
            email: 'member@example.com',
            avatar: 'avatar.png',
            avatar_url: 'avatar.png',
            status: 'active',
            role: 'editor',
          },
        ],
      },
    } as ReturnType<typeof mockMembersQuery>)
    mockModelListQuery.mockImplementation((type: ModelTypeEnum) => ({
      data: [
        createModelCatalogFixture({
          provider: type === ModelTypeEnum.rerank ? 'rerank-provider' : 'embed-provider',
          models: [
            createCatalogModelFixture({
              model: type === ModelTypeEnum.rerank ? 'rerank-model' : 'embed-model',
              model_type: type,
            }),
          ],
        }),
      ],
    }))
    mockUpdateDatasetSetting.mockResolvedValue(createDataset())
  })

  // Rendering and basic field bindings.
  describe('Rendering', () => {
    it('should show external knowledge info when dataset is external', async () => {
      const dataset = createDataset({
        provider: 'external',
        external_knowledge_info: {
          external_knowledge_id: 'ext-id-123',
          external_knowledge_api_id: 'ext-api-id-123',
          external_knowledge_api_name: 'External Knowledge API',
          external_knowledge_api_endpoint: 'https://api.external.com',
        },
      })

      await renderSettingsModal(dataset)

      expect(screen.getByText('External Knowledge API')).toBeInTheDocument()
      expect(screen.getByText('https://api.external.com')).toBeInTheDocument()
      expect(screen.getByText('ext-id-123')).toBeInTheDocument()
    })
  })

  // User interactions that update visible state.
  describe('Interactions', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup()

      await renderSettingsModal(createDataset())
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
      expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
    })

    it('should show and dismiss retrieval change tip when indexing method changes', async () => {
      const user = userEvent.setup()
      const dataset = createDataset({ indexing_technique: IndexingType.ECONOMICAL })

      await renderSettingsModal(dataset)
      await user.click(screen.getByText('datasetCreation.stepTwo.qualified'))

      expect(
        await screen.findByText('appDebug.datasetConfig.retrieveChangeTip'),
      ).toBeInTheDocument()

      await user.click(screen.getByLabelText('close-retrieval-change-tip'))

      await waitFor(() => {
        expect(
          screen.queryByText('appDebug.datasetConfig.retrieveChangeTip'),
        ).not.toBeInTheDocument()
      })
    })

    it('should open account setting modal when embedding model tip is clicked', async () => {
      const user = userEvent.setup()

      await renderSettingsModal(createDataset())
      await user.click(
        screen.getByRole('button', { name: 'datasetSettings.form.embeddingModelTipLink' }),
      )

      await waitFor(() =>
        expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('provider'),
      )
    })
  })

  // Dataset ACL permissions control whether the legacy dataset permission selector is editable.
  describe('Permission Handling', () => {
    it('prevents changing permissions when the embedding model is unavailable', async () => {
      const dataset = createDataset({ embedding_available: false })

      const user = userEvent.setup()
      renderWithProviders(dataset)

      const permission = screen.getByRole('button', {
        name: 'datasetSettings.form.permissionsAllMember',
      })
      expect(permission).toBeDisabled()
      await user.click(permission)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  // Validation guardrails before saving.
  describe('Validation', () => {
    it('should block save when dataset name is empty', async () => {
      const user = userEvent.setup()
      await renderSettingsModal(createDataset())

      const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })

      await user.clear(nameInput)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(toastMocks.call).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: 'datasetSettings.form.nameError',
        }),
      )
      expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
    })

    it('should block save when reranking is enabled without model', async () => {
      const user = userEvent.setup()
      mockModelListQuery.mockReturnValue({ data: [] })
      const dataset = createDataset(
        {},
        createRetrievalConfig({
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        }),
      )

      await renderSettingsModal(dataset)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(toastMocks.call).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: 'appDebug.datasetConfig.rerankModelRequired',
        }),
      )
      expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
    })
  })

  // Save flows and side effects.
  describe('Save', () => {
    it('should save internal dataset changes when form is valid', async () => {
      const user = userEvent.setup()
      const rerankRetrieval = createRetrievalConfig({
        reranking_enable: true,
        reranking_model: {
          reranking_provider_name: 'rerank-provider',
          reranking_model_name: 'rerank-model',
        },
      })
      const dataset = createDataset({
        retrieval_model_dict: rerankRetrieval,
      })

      await renderSettingsModal(dataset)

      const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Internal Dataset')
      const description = screen.getByPlaceholderText('datasetSettings.form.descPlaceholder')
      await user.clear(description)
      await user.type(description, 'Updated description')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(mockUpdateDatasetSetting).toHaveBeenCalled())

      expect(mockUpdateDatasetSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            name: 'Updated Internal Dataset',
            description: 'Updated description',
            permission: PermissionLevel.allTeamMembers,
          }),
        }),
      )
      expect(toastMocks.call).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          message: 'common.actionMsg.modifiedSuccessfully',
        }),
      )
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Updated Internal Dataset',
          retrieval_model_dict: expect.objectContaining({
            reranking_enable: true,
          }),
        }),
      )
    })

    it('should persist reranking_enable=true for hybrid search with a rerank model and a stale false flag', async () => {
      const user = userEvent.setup()
      const hybridRetrieval = createRetrievalConfig({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_enable: false,
        reranking_mode: RerankingModeEnum.RerankingModel,
        reranking_model: {
          reranking_provider_name: 'rerank-provider',
          reranking_model_name: 'rerank-model',
        },
      })
      const dataset = createDataset({
        retrieval_model_dict: hybridRetrieval,
      })

      await renderSettingsModal(dataset)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(mockUpdateDatasetSetting).toHaveBeenCalled())

      expect(mockUpdateDatasetSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            retrieval_model: expect.objectContaining({
              search_method: RETRIEVE_METHOD.hybrid,
              reranking_enable: true,
            }),
          }),
        }),
      )
    })

    it('should keep reranking_enable=false for hybrid search using weighted score', async () => {
      const user = userEvent.setup()
      const hybridRetrieval = createRetrievalConfig({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_enable: false,
        reranking_mode: RerankingModeEnum.WeightedScore,
        reranking_model: {
          reranking_provider_name: 'rerank-provider',
          reranking_model_name: 'rerank-model',
        },
        weights: {
          vector_setting: {
            vector_weight: 0.7,
            embedding_provider_name: 'embed-provider',
            embedding_model_name: 'embed-model',
          },
          keyword_setting: {
            keyword_weight: 0.3,
          },
        },
      } as Partial<RetrievalConfig>)
      const dataset = createDataset({
        retrieval_model_dict: hybridRetrieval,
      })

      await renderSettingsModal(dataset)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(mockUpdateDatasetSetting).toHaveBeenCalled())

      expect(mockUpdateDatasetSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            retrieval_model: expect.objectContaining({
              reranking_enable: false,
            }),
          }),
        }),
      )
    })

    it('should save external dataset changes when partial members configured', async () => {
      const user = userEvent.setup()
      const dataset = createDataset(
        {
          provider: 'external',
          permission: PermissionLevel.partialMembers,
          partial_member_list: createMemberList(),
          external_retrieval_model: {
            top_k: 5,
            score_threshold: 0.3,
            score_threshold_enabled: true,
          },
        },
        {
          score_threshold_enabled: true,
          score_threshold: 0.8,
        },
      )

      await renderSettingsModal(dataset)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(mockUpdateDatasetSetting).toHaveBeenCalled())

      expect(mockUpdateDatasetSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            permission: PermissionLevel.partialMembers,
            external_retrieval_model: expect.objectContaining({
              top_k: 5,
            }),
            partial_member_list: [
              {
                user_id: 'member-2',
                role: 'editor',
              },
            ],
          }),
        }),
      )
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          retrieval_model_dict: expect.objectContaining({
            score_threshold_enabled: true,
            score_threshold: 0.8,
          }),
        }),
      )
    })

    it('should disable save button while saving', async () => {
      const user = userEvent.setup()
      let finishSave!: (dataset: DatasetDetailWithPartialMembersResponse) => void
      mockUpdateDatasetSetting.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishSave = resolve
          }),
      )

      await renderSettingsModal(createDataset())

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      expect(saveButton).toBeDisabled()

      finishSave(createDataset())
      await waitFor(() => expect(saveButton).toBeEnabled())
    })

    it('should show error toast when save fails', async () => {
      const user = userEvent.setup()
      mockUpdateDatasetSetting.mockRejectedValue(new Error('API Error'))

      await renderSettingsModal(createDataset())
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
        expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()
        expect(mockOnSave).not.toHaveBeenCalled()
      })
    })
  })
})
