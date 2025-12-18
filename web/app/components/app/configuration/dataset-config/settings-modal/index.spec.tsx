import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsModal from './index'
import { ToastContext } from '@/app/components/base/toast'
import type { DataSet } from '@/models/datasets'
import { ChunkingMode, DataSourceType, DatasetPermission, RerankingModeEnum } from '@/models/datasets'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { updateDatasetSetting } from '@/service/datasets'
import { fetchMembers } from '@/service/common'
import { RETRIEVE_METHOD, type RetrievalConfig } from '@/types/app'

const mockNotify = jest.fn()
const mockOnCancel = jest.fn()
const mockOnSave = jest.fn()
const mockSetShowAccountSettingModal = jest.fn()
let mockIsWorkspaceDatasetOperator = false

const mockUseModelList = jest.fn()
const mockUseModelListAndDefaultModel = jest.fn()
const mockUseModelListAndDefaultModelAndCurrentProviderAndModel = jest.fn()
const mockUseCurrentProviderAndModel = jest.fn()
const mockCheckShowMultiModalTip = jest.fn()

jest.mock('ky', () => {
  const ky = () => ky
  ky.extend = () => ky
  ky.create = () => ky
  return { __esModule: true, default: ky }
})

jest.mock('@/app/components/datasets/create/step-two', () => ({
  __esModule: true,
  IndexingType: {
    QUALIFIED: 'high_quality',
    ECONOMICAL: 'economy',
  },
}))

jest.mock('@/service/datasets', () => ({
  updateDatasetSetting: jest.fn(),
}))

jest.mock('@/service/common', () => ({
  fetchMembers: jest.fn(),
}))

jest.mock('@/context/app-context', () => ({
  useAppContext: () => ({ isCurrentWorkspaceDatasetOperator: mockIsWorkspaceDatasetOperator }),
  useSelector: <T,>(selector: (value: { userProfile: { id: string; name: string; email: string; avatar_url: string } }) => T) => selector({
    userProfile: {
      id: 'user-1',
      name: 'User One',
      email: 'user@example.com',
      avatar_url: 'avatar.png',
    },
  }),
}))

jest.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

jest.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs${path}`,
}))

jest.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: [],
    textGenerationModelList: [],
    supportRetrievalMethods: [
      RETRIEVE_METHOD.semantic,
      RETRIEVE_METHOD.fullText,
      RETRIEVE_METHOD.hybrid,
      RETRIEVE_METHOD.keywordSearch,
    ],
  }),
}))

jest.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  __esModule: true,
  useModelList: (...args: unknown[]) => mockUseModelList(...args),
  useModelListAndDefaultModel: (...args: unknown[]) => mockUseModelListAndDefaultModel(...args),
  useModelListAndDefaultModelAndCurrentProviderAndModel: (...args: unknown[]) =>
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel(...args),
  useCurrentProviderAndModel: (...args: unknown[]) => mockUseCurrentProviderAndModel(...args),
}))

jest.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  __esModule: true,
  default: ({ defaultModel }: { defaultModel?: { provider: string; model: string } }) => (
    <div data-testid='model-selector'>
      {defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'no-model'}
    </div>
  ),
}))

jest.mock('@/app/components/datasets/settings/utils', () => ({
  checkShowMultiModalTip: (...args: unknown[]) => mockCheckShowMultiModalTip(...args),
}))

const mockUpdateDatasetSetting = updateDatasetSetting as jest.MockedFunction<typeof updateDatasetSetting>
const mockFetchMembers = fetchMembers as jest.MockedFunction<typeof fetchMembers>

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

const createDataset = (overrides: Partial<DataSet> = {}, retrievalOverrides: Partial<RetrievalConfig> = {}): DataSet => {
  const retrievalConfig = createRetrievalConfig(retrievalOverrides)
  return {
    id: 'dataset-id',
    name: 'Test Dataset',
    indexing_status: 'completed',
    icon_info: {
      icon: 'icon',
      icon_type: 'emoji',
    },
    description: 'Description',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    author_name: 'Author',
    created_by: 'creator',
    updated_by: 'updater',
    updated_at: 1700000000,
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 0,
    total_document_count: 0,
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
    ...overrides,
    retrieval_model_dict: {
      ...retrievalConfig,
      ...overrides.retrieval_model_dict,
    },
    retrieval_model: {
      ...retrievalConfig,
      ...overrides.retrieval_model,
    },
  }
}

const renderWithProviders = (dataset: DataSet) => {
  return render(
    <ToastContext.Provider value={{ notify: mockNotify, close: jest.fn() }}>
      <SettingsModal
        currentDataset={dataset}
        onCancel={mockOnCancel}
        onSave={mockOnSave}
      />
    </ToastContext.Provider>,
  )
}

describe('SettingsModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsWorkspaceDatasetOperator = false
    mockUseModelList.mockImplementation((type: ModelTypeEnum) => {
      if (type === ModelTypeEnum.rerank) {
        return {
          data: [
            {
              provider: 'rerank-provider',
              models: [{ model: 'rerank-model' }],
            },
          ],
        }
      }
      return { data: [{ provider: 'embed-provider', models: [{ model: 'embed-model' }] }] }
    })
    mockUseModelListAndDefaultModel.mockReturnValue({ modelList: [], defaultModel: null })
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel.mockReturnValue({ defaultModel: null, currentModel: null })
    mockUseCurrentProviderAndModel.mockReturnValue({ currentProvider: null, currentModel: null })
    mockCheckShowMultiModalTip.mockReturnValue(false)
    mockFetchMembers.mockResolvedValue({
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
    })
    mockUpdateDatasetSetting.mockResolvedValue(createDataset())
  })

  it('renders dataset details', async () => {
    renderWithProviders(createDataset())

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    expect(screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')).toHaveValue('Test Dataset')
    expect(screen.getByPlaceholderText('datasetSettings.form.descPlaceholder')).toHaveValue('Description')
  })

  it('calls onCancel when cancel is clicked', async () => {
    renderWithProviders(createDataset())

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(mockOnCancel).toHaveBeenCalledTimes(1)
  })

  it('shows external knowledge info for external datasets', async () => {
    const dataset = createDataset({
      provider: 'external',
      external_knowledge_info: {
        external_knowledge_id: 'ext-id-123',
        external_knowledge_api_id: 'ext-api-id-123',
        external_knowledge_api_name: 'External Knowledge API',
        external_knowledge_api_endpoint: 'https://api.external.com',
      },
    })

    renderWithProviders(dataset)

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    expect(screen.getByText('External Knowledge API')).toBeInTheDocument()
    expect(screen.getByText('https://api.external.com')).toBeInTheDocument()
    expect(screen.getByText('ext-id-123')).toBeInTheDocument()
  })

  it('updates name when user types', async () => {
    renderWithProviders(createDataset())

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    const nameInput = screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'New Dataset Name')

    expect(nameInput).toHaveValue('New Dataset Name')
  })

  it('updates description when user types', async () => {
    renderWithProviders(createDataset())

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    const descriptionInput = screen.getByPlaceholderText('datasetSettings.form.descPlaceholder')
    await userEvent.clear(descriptionInput)
    await userEvent.type(descriptionInput, 'New description')

    expect(descriptionInput).toHaveValue('New description')
  })

  it('shows and dismisses retrieval change tip when index method changes', async () => {
    const dataset = createDataset({ indexing_technique: IndexingType.ECONOMICAL })

    renderWithProviders(dataset)

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    await userEvent.click(screen.getByText('datasetCreation.stepTwo.qualified'))

    expect(await screen.findByText('appDebug.datasetConfig.retrieveChangeTip')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('close-retrieval-change-tip'))

    await waitFor(() => {
      expect(screen.queryByText('appDebug.datasetConfig.retrieveChangeTip')).not.toBeInTheDocument()
    })
  })

  it('requires dataset name before saving', async () => {
    renderWithProviders(createDataset())

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    const nameInput = screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')
    await userEvent.clear(nameInput)
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: 'datasetSettings.form.nameError',
    }))
    expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
  })

  it('requires rerank model when reranking is enabled', async () => {
    mockUseModelList.mockReturnValue({ data: [] })
    const dataset = createDataset({}, createRetrievalConfig({
      reranking_enable: true,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
    }))

    renderWithProviders(dataset)

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: 'appDebug.datasetConfig.rerankModelRequired',
    }))
    expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
  })

  it('saves internal dataset changes', async () => {
    const rerankRetrieval = createRetrievalConfig({
      reranking_enable: true,
      reranking_model: {
        reranking_provider_name: 'rerank-provider',
        reranking_model_name: 'rerank-model',
      },
    })
    const dataset = createDataset({
      retrieval_model: rerankRetrieval,
      retrieval_model_dict: rerankRetrieval,
    })

    renderWithProviders(dataset)

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    const nameInput = screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Updated Internal Dataset')
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => expect(mockUpdateDatasetSetting).toHaveBeenCalled())

    expect(mockUpdateDatasetSetting).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        name: 'Updated Internal Dataset',
        permission: DatasetPermission.allTeamMembers,
      }),
    }))
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      message: 'common.actionMsg.modifiedSuccessfully',
    }))
    expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Updated Internal Dataset',
      retrieval_model_dict: expect.objectContaining({
        reranking_enable: true,
      }),
    }))
  })

  it('saves external dataset with partial members and updated retrieval params', async () => {
    const dataset = createDataset({
      provider: 'external',
      permission: DatasetPermission.partialMembers,
      partial_member_list: ['member-2'],
      external_retrieval_model: {
        top_k: 5,
        score_threshold: 0.3,
        score_threshold_enabled: true,
      },
    }, {
      score_threshold_enabled: true,
      score_threshold: 0.8,
    })

    renderWithProviders(dataset)

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => expect(mockUpdateDatasetSetting).toHaveBeenCalled())

    expect(mockUpdateDatasetSetting).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        permission: DatasetPermission.partialMembers,
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
    }))
    expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
      retrieval_model_dict: expect.objectContaining({
        score_threshold_enabled: true,
        score_threshold: 0.8,
      }),
    }))
  })

  it('disables save button while saving', async () => {
    mockUpdateDatasetSetting.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

    renderWithProviders(createDataset())

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
    await userEvent.click(saveButton)

    expect(saveButton).toBeDisabled()
  })

  it('shows error toast when save fails', async () => {
    mockUpdateDatasetSetting.mockRejectedValue(new Error('API Error'))

    renderWithProviders(createDataset())

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })
  })
})
