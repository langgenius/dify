import type { MockedFunction } from 'vitest'
import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContext } from '@/app/components/base/toast'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ChunkingMode, DatasetPermission, DataSourceType, RerankingModeEnum } from '@/models/datasets'
import { updateDatasetSetting } from '@/service/datasets'
import { useMembers } from '@/service/use-common'
import { RETRIEVE_METHOD } from '@/types/app'
import SettingsModal from './index'

const mockNotify = vi.fn()
const mockOnCancel = vi.fn()
const mockOnSave = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
let mockIsWorkspaceDatasetOperator = false

const mockUseModelList = vi.fn()
const mockUseModelListAndDefaultModel = vi.fn()
const mockUseModelListAndDefaultModelAndCurrentProviderAndModel = vi.fn()
const mockUseCurrentProviderAndModel = vi.fn()
const mockCheckShowMultiModalTip = vi.fn()

vi.mock('ky', () => {
  const ky = () => ky
  ky.extend = () => ky
  ky.create = () => ky
  return { __esModule: true, default: ky }
})

vi.mock('@/app/components/datasets/create/step-two', () => ({
  IndexingType: {
    QUALIFIED: 'high_quality',
    ECONOMICAL: 'economy',
  },
}))

vi.mock('@/service/datasets', () => ({
  updateDatasetSetting: vi.fn(),
}))

vi.mock('@/service/use-common', async () => ({
  ...(await vi.importActual('@/service/use-common')),
  useMembers: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({ isCurrentWorkspaceDatasetOperator: mockIsWorkspaceDatasetOperator }),
  useSelector: <T,>(selector: (value: { userProfile: { id: string, name: string, email: string, avatar_url: string } }) => T) => selector({
    userProfile: {
      id: 'user-1',
      name: 'User One',
      email: 'user@example.com',
      avatar_url: 'avatar.png',
    },
  }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs${path}`,
}))

vi.mock('@/context/provider-context', () => ({
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

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: (...args: unknown[]) => mockUseModelList(...args),
  useModelListAndDefaultModel: (...args: unknown[]) => mockUseModelListAndDefaultModel(...args),
  useModelListAndDefaultModelAndCurrentProviderAndModel: (...args: unknown[]) =>
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel(...args),
  useCurrentProviderAndModel: (...args: unknown[]) => mockUseCurrentProviderAndModel(...args),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ defaultModel }: { defaultModel?: { provider: string, model: string } }) => (
    <div data-testid="model-selector">
      {defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'no-model'}
    </div>
  ),
}))

vi.mock('@/app/components/datasets/settings/utils', () => ({
  checkShowMultiModalTip: (...args: unknown[]) => mockCheckShowMultiModalTip(...args),
}))

const mockUpdateDatasetSetting = updateDatasetSetting as MockedFunction<typeof updateDatasetSetting>
const mockUseMembers = useMembers as MockedFunction<typeof useMembers>

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
    <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
      <SettingsModal
        currentDataset={dataset}
        onCancel={mockOnCancel}
        onSave={mockOnSave}
      />
    </ToastContext.Provider>,
  )
}

const createMemberList = (): DataSet['partial_member_list'] => ([
  'member-2',
])

const renderSettingsModal = async (dataset: DataSet) => {
  renderWithProviders(dataset)
  await waitFor(() => expect(mockUseMembers).toHaveBeenCalled())
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsWorkspaceDatasetOperator = false
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
    } as ReturnType<typeof useMembers>)
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
    mockUpdateDatasetSetting.mockResolvedValue(createDataset())
  })

  // Rendering and basic field bindings.
  describe('Rendering', () => {
    it('should render dataset details when dataset is provided', async () => {
      // Arrange
      const dataset = createDataset()

      // Act
      await renderSettingsModal(dataset)

      // Assert
      expect(screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')).toHaveValue('Test Dataset')
      expect(screen.getByPlaceholderText('datasetSettings.form.descPlaceholder')).toHaveValue('Description')
    })

    it('should show external knowledge info when dataset is external', async () => {
      // Arrange
      const dataset = createDataset({
        provider: 'external',
        external_knowledge_info: {
          external_knowledge_id: 'ext-id-123',
          external_knowledge_api_id: 'ext-api-id-123',
          external_knowledge_api_name: 'External Knowledge API',
          external_knowledge_api_endpoint: 'https://api.external.com',
        },
      })

      // Act
      await renderSettingsModal(dataset)

      // Assert
      expect(screen.getByText('External Knowledge API')).toBeInTheDocument()
      expect(screen.getByText('https://api.external.com')).toBeInTheDocument()
      expect(screen.getByText('ext-id-123')).toBeInTheDocument()
    })
  })

  // User interactions that update visible state.
  describe('Interactions', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      await renderSettingsModal(createDataset())
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      // Assert
      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should update name input when user types', async () => {
      // Arrange
      const user = userEvent.setup()
      await renderSettingsModal(createDataset())

      const nameInput = screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')

      // Act
      await user.clear(nameInput)
      await user.type(nameInput, 'New Dataset Name')

      // Assert
      expect(nameInput).toHaveValue('New Dataset Name')
    })

    it('should update description input when user types', async () => {
      // Arrange
      const user = userEvent.setup()
      await renderSettingsModal(createDataset())

      const descriptionInput = screen.getByPlaceholderText('datasetSettings.form.descPlaceholder')

      // Act
      await user.clear(descriptionInput)
      await user.type(descriptionInput, 'New description')

      // Assert
      expect(descriptionInput).toHaveValue('New description')
    })

    it('should show and dismiss retrieval change tip when indexing method changes', async () => {
      // Arrange
      const user = userEvent.setup()
      const dataset = createDataset({ indexing_technique: IndexingType.ECONOMICAL })

      // Act
      await renderSettingsModal(dataset)
      await user.click(screen.getByText('datasetCreation.stepTwo.qualified'))

      // Assert
      expect(await screen.findByText('appDebug.datasetConfig.retrieveChangeTip')).toBeInTheDocument()

      // Act
      await user.click(screen.getByLabelText('close-retrieval-change-tip'))

      // Assert
      await waitFor(() => {
        expect(screen.queryByText('appDebug.datasetConfig.retrieveChangeTip')).not.toBeInTheDocument()
      })
    })

    it('should open account setting modal when embedding model tip is clicked', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      await renderSettingsModal(createDataset())
      await user.click(screen.getByText('datasetSettings.form.embeddingModelTipLink'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.PROVIDER })
    })
  })

  // Validation guardrails before saving.
  describe('Validation', () => {
    it('should block save when dataset name is empty', async () => {
      // Arrange
      const user = userEvent.setup()
      await renderSettingsModal(createDataset())

      const nameInput = screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')

      // Act
      await user.clear(nameInput)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: 'datasetSettings.form.nameError',
      }))
      expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
    })

    it('should block save when reranking is enabled without model', async () => {
      // Arrange
      const user = userEvent.setup()
      mockUseModelList.mockReturnValue({ data: [] })
      const dataset = createDataset({}, createRetrievalConfig({
        reranking_enable: true,
        reranking_model: {
          reranking_provider_name: '',
          reranking_model_name: '',
        },
      }))

      // Act
      await renderSettingsModal(dataset)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: 'appDebug.datasetConfig.rerankModelRequired',
      }))
      expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
    })
  })

  // Save flows and side effects.
  describe('Save', () => {
    it('should save internal dataset changes when form is valid', async () => {
      // Arrange
      const user = userEvent.setup()
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

      // Act
      await renderSettingsModal(dataset)

      const nameInput = screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Internal Dataset')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
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

    it('should save external dataset changes when partial members configured', async () => {
      // Arrange
      const user = userEvent.setup()
      const dataset = createDataset({
        provider: 'external',
        permission: DatasetPermission.partialMembers,
        partial_member_list: createMemberList(),
        external_retrieval_model: {
          top_k: 5,
          score_threshold: 0.3,
          score_threshold_enabled: true,
        },
      }, {
        score_threshold_enabled: true,
        score_threshold: 0.8,
      })

      // Act
      await renderSettingsModal(dataset)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
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

    it('should disable save button while saving', async () => {
      // Arrange
      const user = userEvent.setup()
      mockUpdateDatasetSetting.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      // Act
      await renderSettingsModal(createDataset())

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      // Assert
      expect(saveButton).toBeDisabled()
    })

    it('should show error toast when save fails', async () => {
      // Arrange
      const user = userEvent.setup()
      mockUpdateDatasetSetting.mockRejectedValue(new Error('API Error'))

      // Act
      await renderSettingsModal(createDataset())
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      })
    })
  })
})
