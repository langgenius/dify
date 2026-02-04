import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../create/step-two'
import Form from './index'

// Mock contexts
const mockMutateDatasets = vi.fn()
const mockInvalidDatasetList = vi.fn()

const mockUserProfile = {
  id: 'user-1',
  name: 'Current User',
  email: 'current@example.com',
  avatar_url: '',
  role: 'owner',
}

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: unknown) => unknown) => {
    const state = {
      isCurrentWorkspaceDatasetOperator: false,
      userProfile: mockUserProfile,
    }
    return selector(state)
  },
}))

const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
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
  ...overrides,
})

let mockDataset: DataSet = createMockDataset()

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
  useModelList: () => ({ data: [], mutate: vi.fn(), isLoading: false }),
  useCurrentProviderAndModel: () => ({ currentProvider: undefined, currentModel: undefined }),
  useDefaultModel: () => ({ data: undefined, mutate: vi.fn(), isLoading: false }),
  useModelListAndDefaultModel: () => ({ modelList: [], defaultModel: undefined }),
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    modelList: [],
    defaultModel: undefined,
    currentProvider: undefined,
    currentModel: undefined,
  }),
  useUpdateModelList: () => vi.fn(),
  useUpdateModelProviders: () => vi.fn(),
  useLanguage: () => 'en_US',
  useSystemDefaultModelAndModelList: () => [undefined, vi.fn()],
  useProviderCredentialsAndLoadBalancing: () => ({
    credentials: undefined,
    loadBalancing: undefined,
    mutate: vi.fn(),
    isLoading: false,
  }),
  useAnthropicBuyQuota: () => vi.fn(),
  useMarketplaceAllPlugins: () => ({ plugins: [], isLoading: false }),
  useRefreshModel: () => ({ handleRefreshModel: vi.fn() }),
  useModelModalHandler: () => vi.fn(),
}))

// Mock provider-context
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    textGenerationModelList: [],
    embeddingsModelList: [],
    rerankModelList: [],
    agentThoughtModelList: [],
    modelProviders: [],
    textEmbeddingModelList: [],
    speech2textModelList: [],
    ttsModelList: [],
    moderationModelList: [],
    hasSettedApiKey: true,
    plan: { type: 'free' },
    enableBilling: false,
    onPlanInfoChanged: vi.fn(),
    isCurrentWorkspaceDatasetOperator: false,
    supportRetrievalMethods: ['semantic_search', 'full_text_search', 'hybrid_search'],
  }),
}))

vi.mock('@/app/components/datasets/common/check-rerank-model', () => ({
  isReRankModelSelected: () => true,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

describe('Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createMockDataset()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Form />)
      expect(screen.getByRole('button', { name: /form\.save/i })).toBeInTheDocument()
    })

    it('should render dataset name input with initial value', () => {
      render(<Form />)
      const nameInput = screen.getByDisplayValue('Test Dataset')
      expect(nameInput).toBeInTheDocument()
    })

    it('should render dataset description textarea', () => {
      render(<Form />)
      const descriptionTextarea = screen.getByDisplayValue('Test description')
      expect(descriptionTextarea).toBeInTheDocument()
    })

    it('should render save button', () => {
      render(<Form />)
      const saveButton = screen.getByRole('button', { name: /form\.save/i })
      expect(saveButton).toBeInTheDocument()
    })

    it('should render permission selector', () => {
      render(<Form />)
      // Permission selector renders the current permission text
      expect(screen.getByText(/form\.permissionsOnlyMe/i)).toBeInTheDocument()
    })
  })

  describe('BasicInfoSection', () => {
    it('should allow editing dataset name', () => {
      render(<Form />)
      const nameInput = screen.getByDisplayValue('Test Dataset')

      fireEvent.change(nameInput, { target: { value: 'Updated Dataset Name' } })

      expect(nameInput).toHaveValue('Updated Dataset Name')
    })

    it('should allow editing dataset description', () => {
      render(<Form />)
      const descriptionTextarea = screen.getByDisplayValue('Test description')

      fireEvent.change(descriptionTextarea, { target: { value: 'Updated description' } })

      expect(descriptionTextarea).toHaveValue('Updated description')
    })

    it('should render app icon', () => {
      const { container } = render(<Form />)
      // The app icon wrapper should be rendered (icon may be in a span or SVG)
      // The icon is rendered within a clickable container in the name and icon section
      const iconSection = container.querySelector('[class*="cursor-pointer"]')
      expect(iconSection).toBeInTheDocument()
    })
  })

  describe('IndexingSection - Internal Provider', () => {
    it('should render chunk structure section when doc_form is set', () => {
      render(<Form />)
      expect(screen.getByText(/form\.chunkStructure\.title/i)).toBeInTheDocument()
    })

    it('should render index method section', () => {
      render(<Form />)
      // May match multiple elements (label and descriptions)
      expect(screen.getAllByText(/form\.indexMethod/i).length).toBeGreaterThan(0)
    })

    it('should render embedding model section when indexMethod is high_quality', () => {
      render(<Form />)
      expect(screen.getByText(/form\.embeddingModel/i)).toBeInTheDocument()
    })

    it('should render retrieval settings section', () => {
      render(<Form />)
      expect(screen.getByText(/form\.retrievalSetting\.title/i)).toBeInTheDocument()
    })

    it('should render learn more links', () => {
      render(<Form />)
      const learnMoreLinks = screen.getAllByText(/learnMore/i)
      expect(learnMoreLinks.length).toBeGreaterThan(0)
    })
  })

  describe('ExternalKnowledgeSection - External Provider', () => {
    beforeEach(() => {
      mockDataset = createMockDataset({ provider: 'external' })
    })

    it('should render external knowledge API info when provider is external', () => {
      render(<Form />)
      expect(screen.getByText(/form\.externalKnowledgeAPI/i)).toBeInTheDocument()
    })

    it('should render external knowledge ID when provider is external', () => {
      render(<Form />)
      expect(screen.getByText(/form\.externalKnowledgeID/i)).toBeInTheDocument()
    })

    it('should display external API name', () => {
      render(<Form />)
      expect(screen.getByText('External API')).toBeInTheDocument()
    })

    it('should display external API endpoint', () => {
      render(<Form />)
      expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    })

    it('should display external knowledge ID value', () => {
      render(<Form />)
      expect(screen.getByText('ext-1')).toBeInTheDocument()
    })
  })

  describe('Save Functionality', () => {
    it('should call save when save button is clicked', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      render(<Form />)

      const saveButton = screen.getByRole('button', { name: /form\.save/i })
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(updateDatasetSetting).toHaveBeenCalled()
      })
    })

    it('should show loading state on save button while saving', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      vi.mocked(updateDatasetSetting).mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100)),
      )

      render(<Form />)

      const saveButton = screen.getByRole('button', { name: /form\.save/i })
      fireEvent.click(saveButton)

      // Button should be disabled during loading
      await waitFor(() => {
        expect(saveButton).toBeDisabled()
      })
    })

    it('should show error when trying to save with empty name', async () => {
      const Toast = await import('@/app/components/base/toast')
      render(<Form />)

      // Clear the name
      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: '' } })

      // Try to save
      const saveButton = screen.getByRole('button', { name: /form\.save/i })
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(Toast.default.notify).toHaveBeenCalledWith({
          type: 'error',
          message: expect.any(String),
        })
      })
    })

    it('should save with updated name', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      render(<Form />)

      // Update name
      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: 'New Dataset Name' } })

      // Save
      const saveButton = screen.getByRole('button', { name: /form\.save/i })
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(updateDatasetSetting).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              name: 'New Dataset Name',
            }),
          }),
        )
      })
    })

    it('should save with updated description', async () => {
      const { updateDatasetSetting } = await import('@/service/datasets')
      render(<Form />)

      // Update description
      const descriptionTextarea = screen.getByDisplayValue('Test description')
      fireEvent.change(descriptionTextarea, { target: { value: 'New description' } })

      // Save
      const saveButton = screen.getByRole('button', { name: /form\.save/i })
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(updateDatasetSetting).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              description: 'New description',
            }),
          }),
        )
      })
    })
  })

  describe('Disabled States', () => {
    it('should disable inputs when embedding is not available', () => {
      mockDataset = createMockDataset({ embedding_available: false })
      render(<Form />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      expect(nameInput).toBeDisabled()

      const descriptionTextarea = screen.getByDisplayValue('Test description')
      expect(descriptionTextarea).toBeDisabled()
    })
  })

  describe('Conditional Rendering', () => {
    it('should not render chunk structure when doc_form is not set', () => {
      mockDataset = createMockDataset({ doc_form: undefined as unknown as ChunkingMode })
      render(<Form />)

      // Chunk structure should not be present
      expect(screen.queryByText(/form\.chunkStructure\.title/i)).not.toBeInTheDocument()
    })

    it('should render IndexingSection for internal provider', () => {
      mockDataset = createMockDataset({ provider: 'vendor' })
      render(<Form />)

      // May match multiple elements (label and descriptions)
      expect(screen.getAllByText(/form\.indexMethod/i).length).toBeGreaterThan(0)
      expect(screen.queryByText(/form\.externalKnowledgeAPI/i)).not.toBeInTheDocument()
    })

    it('should render ExternalKnowledgeSection for external provider', () => {
      mockDataset = createMockDataset({ provider: 'external' })
      render(<Form />)

      expect(screen.getByText(/form\.externalKnowledgeAPI/i)).toBeInTheDocument()
    })
  })

  describe('Permission Selection', () => {
    it('should open permission dropdown when clicked', async () => {
      render(<Form />)

      const permissionTrigger = screen.getByText(/form\.permissionsOnlyMe/i)
      fireEvent.click(permissionTrigger)

      await waitFor(() => {
        // Should show all permission options
        expect(screen.getAllByText(/form\.permissionsOnlyMe/i).length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('Integration', () => {
    it('should render all main sections', () => {
      render(<Form />)

      // Basic info
      expect(screen.getByText(/form\.nameAndIcon/i)).toBeInTheDocument()
      expect(screen.getByText(/form\.desc/i)).toBeInTheDocument()
      // form.permissions matches multiple elements (label and permission options)
      expect(screen.getAllByText(/form\.permissions/i).length).toBeGreaterThan(0)

      // Indexing (for internal provider)
      expect(screen.getByText(/form\.chunkStructure\.title/i)).toBeInTheDocument()
      // form.indexMethod matches multiple elements
      expect(screen.getAllByText(/form\.indexMethod/i).length).toBeGreaterThan(0)

      // Save button
      expect(screen.getByRole('button', { name: /form\.save/i })).toBeInTheDocument()
    })
  })
})
