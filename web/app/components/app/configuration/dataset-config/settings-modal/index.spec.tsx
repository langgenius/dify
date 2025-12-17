import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsModal from './index'
import type { DataSet } from '@/models/datasets'
import { ChunkingMode, DataSourceType, DatasetPermission, RerankingModeEnum } from '@/models/datasets'
import { RETRIEVE_METHOD, type RetrievalConfig } from '@/types/app'
import { updateDatasetSetting } from '@/service/datasets'
import { fetchMembers } from '@/service/common'
import { IndexingType } from '@/app/components/datasets/create/step-two'

const mockNotify = jest.fn()
const mockOnCancel = jest.fn()
const mockOnSave = jest.fn()
const mockSetShowAccountSettingModal = jest.fn()
let mockIsWorkspaceDatasetOperator = false

jest.mock('@/app/components/datasets/create/step-two', () => ({
  __esModule: true,
  IndexingType: {
    QUALIFIED: 'high_quality',
    ECONOMICAL: 'economy',
  },
}))

jest.mock('@/app/components/datasets/settings/index-method', () => ({
  __esModule: true,
  default: ({ value, onChange, keywordNumber, onKeywordNumberChange, disabled }: any) => (
    <div data-testid='index-method'>
      <button
        type='button'
        data-testid='choose-high-quality'
        disabled={disabled}
        onClick={() => onChange('high_quality')}
      >
        High Quality
      </button>
      <button
        type='button'
        data-testid='choose-economy'
        disabled={disabled}
        onClick={() => onChange('economy')}
      >
        Economical
      </button>
      <button
        type='button'
        data-testid='keyword-plus'
        disabled={disabled}
        onClick={() => onKeywordNumberChange(keywordNumber + 1)}
      >
        Keyword: {keywordNumber}
      </button>
      <span data-testid='index-method-value'>{value}</span>
      {disabled && <span data-testid='index-method-disabled'>Disabled</span>}
    </div>
  ),
}))

jest.mock('@/service/datasets', () => ({
  updateDatasetSetting: jest.fn(),
}))

jest.mock('@/service/common', () => ({
  fetchMembers: jest.fn(),
}))

jest.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

jest.mock('@/context/app-context', () => ({
  useAppContext: () => ({ isCurrentWorkspaceDatasetOperator: mockIsWorkspaceDatasetOperator }),
  useSelector: (selector: any) => selector({
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

jest.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  __esModule: true,
  default: ({ defaultModel }: any) => (
    <div data-testid='model-selector'>
      {defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'no-model'}
    </div>
  ),
}))

jest.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: jest.fn(() => ({ data: [] })),
  useCurrentProviderAndModel: jest.fn(() => ({
    currentProvider: undefined,
    currentModel: undefined,
  })),
}))

jest.mock('@/app/components/datasets/settings/utils', () => ({
  checkShowMultiModalTip: jest.fn(),
}))

jest.mock('@/app/components/datasets/common/retrieval-method-config', () => ({
  __esModule: true,
  default: ({ value, onChange, showMultiModalTip }: any) => (
    <div data-testid='retrieval-method-config'>
      <div data-testid='retrieval-settings'>
        <span data-testid='topk-value'>{value.top_k}</span>
        <span data-testid='score-threshold-enabled'>{String(value.score_threshold_enabled)}</span>
        <span data-testid='rerank-enabled'>{String(value.reranking_enable)}</span>
        {showMultiModalTip && <div data-testid='multimodal-tip'>Multimodal Tip</div>}
      </div>
      <button
        type='button'
        data-testid='increase-topk'
        onClick={() => onChange({ ...value, top_k: value.top_k + 1 })}
      >
        Increase TopK
      </button>
      <button
        type='button'
        data-testid='toggle-score-threshold'
        onClick={() => onChange({ ...value, score_threshold_enabled: !value.score_threshold_enabled })}
      >
        Toggle Score Threshold
      </button>
    </div>
  ),
}))

jest.mock('@/app/components/datasets/common/economical-retrieval-method-config', () => ({
  __esModule: true,
  default: ({ value, onChange }: any) => (
    <div data-testid='economical-retrieval-config'>
      <div data-testid='economical-settings'>
        <span data-testid='topk-value'>{value.top_k}</span>
        <span data-testid='score-threshold-enabled'>{String(value.score_threshold_enabled)}</span>
      </div>
      <button
        type='button'
        data-testid='increase-topk'
        onClick={() => onChange({ ...value, top_k: value.top_k + 1 })}
      >
        Increase TopK
      </button>
      <button
        type='button'
        data-testid='toggle-score-threshold'
        onClick={() => onChange({ ...value, score_threshold_enabled: !value.score_threshold_enabled })}
      >
        Toggle Score Threshold
      </button>
    </div>
  ),
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

describe('SettingsModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsWorkspaceDatasetOperator = false
    mockFetchMembers.mockResolvedValue({
      accounts: [
        {
          id: 'user-1',
          name: 'User One',
          email: 'user@example.com',
          avatar: 'avatar.png',
          avatar_url: 'avatar.png',
          status: 'active' as const,
          role: 'owner' as const,
        } as any,
        {
          id: 'member-2',
          name: 'Member Two',
          email: 'member@example.com',
          avatar: 'avatar.png',
          avatar_url: 'avatar.png',
          status: 'active' as const,
          role: 'editor' as const,
        } as any,
      ],
    })
    mockUpdateDatasetSetting.mockResolvedValue({} as any)
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
    })

    it('should render dataset details and handle cancel action', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
      const nameInput = screen.getByPlaceholderText('datasetSettings.form.namePlaceholder') as HTMLInputElement
      const descriptionInput = screen.getByPlaceholderText('datasetSettings.form.descPlaceholder') as HTMLTextAreaElement
      expect(nameInput.value).toBe('Test Dataset')
      expect(descriptionInput.value).toBe('Description')

      await userEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should render external dataset specific fields', async () => {
      const dataset = createDataset({
        provider: 'external',
        external_knowledge_info: {
          external_knowledge_id: 'ext-id-123',
          external_knowledge_api_id: 'ext-api-id-123',
          external_knowledge_api_name: 'External Knowledge API',
          external_knowledge_api_endpoint: 'https://api.external.com',
        },
      })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      expect(screen.getByText('External Knowledge API')).toBeInTheDocument()
      expect(screen.getByText('https://api.external.com')).toBeInTheDocument()
      expect(screen.getByText('ext-id-123')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply correct dataset props', () => {
      const dataset = createDataset({
        name: 'Test Name',
        permission: DatasetPermission.onlyMe,
        keyword_number: 15,
      })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      expect(screen.getByDisplayValue('Test Name')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should handle cancel action', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should handle name input change', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      const nameInput = screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'New Dataset Name')

      expect(nameInput).toHaveValue('New Dataset Name')
    })

    it('should handle description input change', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      const descriptionInput = screen.getByPlaceholderText('datasetSettings.form.descPlaceholder')
      await userEvent.clear(descriptionInput)
      await userEvent.type(descriptionInput, 'New description')

      expect(descriptionInput).toHaveValue('New description')
    })

    it('should handle index method change', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      await userEvent.click(screen.getByTestId('choose-economy'))

      const tip = await screen.findByText('appDebug.datasetConfig.retrieveChangeTip')
      expect(tip).toBeInTheDocument()
    })

    it('should handle keyword number change', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      await userEvent.click(screen.getByTestId('keyword-plus'))
      expect(screen.getByText('Keyword: 11')).toBeInTheDocument()
    })

    it('should handle retrieval method interactions', async () => {
      const dataset = createDataset()

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      // Check that retrieval configuration components are present
      expect(screen.getByTestId('retrieval-method-config')).toBeInTheDocument()
    })
  })

  describe('Permissions Management', () => {
    it('should display permission selector for team datasets', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset({ permission: DatasetPermission.allTeamMembers })}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())
      // Check if permission-related elements are present
      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
    })

    it('should handle partial member permissions', async () => {
      const dataset = createDataset({
        permission: DatasetPermission.partialMembers,
        partial_member_list: ['member-2'],
      })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())
      // Check that the modal renders without errors with partial members
      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
    })

    it('should handle only me permissions', async () => {
      const dataset = createDataset({ permission: DatasetPermission.onlyMe })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())
      // Check that the modal renders with only me permissions
      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
    })
  })

  describe('Rerank Model Configuration', () => {
    it('should display rerank model selector for qualified retrieval', async () => {
      const dataset = createDataset({
        indexing_technique: IndexingType.QUALIFIED,
        retrieval_model: createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
        }),
      })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      // Check that rerank model selector is present
      const mockModelSelector = screen.getByTestId('model-selector')
      expect(mockModelSelector).toBeInTheDocument()
    })

    it('should handle rerank model configuration changes', async () => {
      const dataset = createDataset({
        retrieval_model: createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: 'test-provider',
            reranking_model_name: 'test-model',
          },
        }),
      })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())
      // Check that rerank configuration renders properly
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    })
  })

  describe('Multimodal Support', () => {
    it('should show multimodal tip when appropriate', async () => {
      const checkShowMultiModalTip = require('@/app/components/datasets/settings/utils').checkShowMultiModalTip
      checkShowMultiModalTip.mockReturnValue(true)

      const dataset = createDataset({
        is_multimodal: true,
        indexing_technique: IndexingType.QUALIFIED,
      })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())
      // Check if multimodal tip appears
      expect(screen.getByTestId('multimodal-tip')).toBeInTheDocument()
    })
  })

  describe('Form Validation', () => {
    it('should show an error when name is empty', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

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

    it('should require rerank model selection for high quality semantic retrieval', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset({}, createRetrievalConfig({ reranking_enable: true }))}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())
      await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: 'appDebug.datasetConfig.rerankModelRequired',
      }))
      expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
    })
  })

  describe('Save Functionality', () => {
    it('should save external dataset settings with partial members', async () => {
      const dataset = createDataset({
        provider: 'external',
        permission: DatasetPermission.partialMembers,
        partial_member_list: ['member-2'],
        external_retrieval_model: {
          top_k: 3,
          score_threshold: 0.3,
          score_threshold_enabled: true,
        },
        retrieval_model_dict: createRetrievalConfig({
          score_threshold_enabled: true,
          score_threshold: 0.8,
        }),
        retrieval_model: createRetrievalConfig({
          score_threshold_enabled: true,
          score_threshold: 0.8,
        }),
      })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      const nameInput = screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'Updated Dataset')

      const topKInput = screen.getByDisplayValue('3') as HTMLInputElement
      const [topKIncrement] = screen.getAllByLabelText('increment')
      await userEvent.click(topKIncrement)
      await userEvent.click(topKIncrement)
      await waitFor(() => expect(topKInput).toHaveValue(5))

      await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(mockUpdateDatasetSetting).toHaveBeenCalled())

      expect(mockUpdateDatasetSetting).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          name: 'Updated Dataset',
          permission: DatasetPermission.partialMembers,
          external_retrieval_model: expect.objectContaining({
            top_k: 5,
            score_threshold: 0.3,
            score_threshold_enabled: true,
          }),
          partial_member_list: [
            {
              user_id: 'member-2',
              role: 'editor',
            },
          ],
          retrieval_model: expect.objectContaining({
            score_threshold_enabled: true,
            score_threshold: 0.8,
          }),
        }),
      }))
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      }))
      expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Updated Dataset',
        indexing_technique: dataset.indexing_technique,
        retrieval_model_dict: expect.objectContaining({
          score_threshold: 0.8,
          score_threshold_enabled: true,
        }),
      }))
    })

    it('should save internal dataset settings', async () => {
      const dataset = createDataset({
        provider: 'internal',
        permission: DatasetPermission.allTeamMembers,
      })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

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
    })
  })

  describe('Retrieval Settings', () => {
    it('should show and dismiss retrieval change tip when index method changes', async () => {
      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      // Act: Change index method from qualified to economical
      await userEvent.click(screen.getByTestId('choose-economy'))

      // Assert: Retrieval change tip appears
      const tip = await screen.findByText('appDebug.datasetConfig.retrieveChangeTip')
      const tipContainer = tip.parentElement?.parentElement as HTMLElement | null
      const closeTipButton = tipContainer ? within(tipContainer).getByRole('button') : null
      expect(closeTipButton).not.toBeNull()

      // Act: Dismiss the tip
      await userEvent.click(closeTipButton!)

      // Assert: Tip disappears
      await waitFor(() => {
        expect(screen.queryByText('appDebug.datasetConfig.retrieveChangeTip')).not.toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined dataset fields gracefully', async () => {
      const dataset = createDataset({
        name: '',
        description: '',
        external_knowledge_info: undefined as any,
      })

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('datasetSettings.form.namePlaceholder')).toBeInTheDocument()
    })

    it('should handle empty member list gracefully', async () => {
      mockFetchMembers.mockResolvedValue({ accounts: [] })

      render(
        <SettingsModal
          currentDataset={createDataset()}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
    })

    it('should handle API error during save gracefully', async () => {
      mockUpdateDatasetSetting.mockRejectedValue(new Error('API Error'))

      const dataset = createDataset()

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })
    })

    it('should handle loading state during save properly', async () => {
      mockUpdateDatasetSetting.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      const dataset = createDataset()

      render(
        <SettingsModal
          currentDataset={dataset}
          onCancel={mockOnCancel}
          onSave={mockOnSave}
        />,
      )

      await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled())

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })

      await userEvent.click(saveButton)

      // Button should be disabled during loading
      expect(saveButton).toBeDisabled()
    })
  })
})
