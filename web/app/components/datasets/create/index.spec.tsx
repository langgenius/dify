import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { DataSet } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { DataSourceProvider } from '@/models/common'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import DatasetUpdateForm from './index'

// IndexingType values from step-two (defined here since we mock step-two)
// Using type assertion to match the expected IndexingType enum from step-two
const IndexingTypeValues = {
  QUALIFIED: 'high_quality' as const,
  ECONOMICAL: 'economy' as const,
}

// ==========================================
// Mock External Dependencies
// ==========================================

// Mock next/link
vi.mock('next/link', () => {
  return function MockLink({ children, href }: { children: React.ReactNode, href: string }) {
    return <a href={href}>{children}</a>
  }
})

// Mock modal context
const mockSetShowAccountSettingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (state: any) => any) => {
    const state = {
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    }
    return selector(state)
  },
}))

// Mock dataset detail context
let mockDatasetDetail: DataSet | undefined
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: any) => any) => {
    const state = {
      dataset: mockDatasetDetail,
    }
    return selector(state)
  },
}))

// Mock useDefaultModel hook
let mockEmbeddingsDefaultModel: { model: string, provider: string } | undefined
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({
    data: mockEmbeddingsDefaultModel,
    mutate: vi.fn(),
    isLoading: false,
  }),
}))

// Mock useGetDefaultDataSourceListAuth hook
let mockDataSourceList: { result: DataSourceAuth[] } | undefined
let mockIsLoadingDataSourceList = false
let mockFetchingError = false
vi.mock('@/service/use-datasource', () => ({
  useGetDefaultDataSourceListAuth: () => ({
    data: mockDataSourceList,
    isLoading: mockIsLoadingDataSourceList,
    isError: mockFetchingError,
  }),
}))

// ==========================================
// Mock Child Components
// ==========================================

// Track props passed to child components
let stepOneProps: Record<string, any> = {}
let stepTwoProps: Record<string, any> = {}
let stepThreeProps: Record<string, any> = {}
// _topBarProps is assigned but not directly used in assertions - values checked via data-testid
let _topBarProps: Record<string, any> = {}

vi.mock('./step-one', () => ({
  default: (props: Record<string, any>) => {
    stepOneProps = props
    return (
      <div data-testid="step-one">
        <span data-testid="step-one-data-source-type">{props.dataSourceType}</span>
        <span data-testid="step-one-files-count">{props.files?.length || 0}</span>
        <span data-testid="step-one-notion-pages-count">{props.notionPages?.length || 0}</span>
        <span data-testid="step-one-website-pages-count">{props.websitePages?.length || 0}</span>
        <button data-testid="step-one-next" onClick={props.onStepChange}>Next Step</button>
        <button data-testid="step-one-setting" onClick={props.onSetting}>Open Settings</button>
        <button
          data-testid="step-one-change-type"
          onClick={() => props.changeType(DataSourceType.NOTION)}
        >
          Change Type
        </button>
        <button
          data-testid="step-one-update-files"
          onClick={() => props.updateFileList([{ fileID: 'test-1', file: { name: 'test.txt' }, progress: 0 }])}
        >
          Add File
        </button>
        <button
          data-testid="step-one-update-file-progress"
          onClick={() => {
            const mockFile = { fileID: 'test-1', file: { name: 'test.txt' }, progress: 0 }
            props.updateFile(mockFile, 50, [mockFile])
          }}
        >
          Update File Progress
        </button>
        <button
          data-testid="step-one-update-notion-pages"
          onClick={() => props.updateNotionPages([{ page_id: 'page-1', type: 'page' }])}
        >
          Add Notion Page
        </button>
        <button
          data-testid="step-one-update-notion-credential"
          onClick={() => props.updateNotionCredentialId('credential-123')}
        >
          Update Credential
        </button>
        <button
          data-testid="step-one-update-website-pages"
          onClick={() => props.updateWebsitePages([{ title: 'Test', markdown: '', description: '', source_url: 'https://test.com' }])}
        >
          Add Website Page
        </button>
        <button
          data-testid="step-one-update-crawl-options"
          onClick={() => props.onCrawlOptionsChange({ ...props.crawlOptions, limit: 20 })}
        >
          Update Crawl Options
        </button>
        <button
          data-testid="step-one-update-crawl-provider"
          onClick={() => props.onWebsiteCrawlProviderChange(DataSourceProvider.fireCrawl)}
        >
          Update Crawl Provider
        </button>
        <button
          data-testid="step-one-update-job-id"
          onClick={() => props.onWebsiteCrawlJobIdChange('job-123')}
        >
          Update Job ID
        </button>
      </div>
    )
  },
}))

vi.mock('./step-two', () => ({
  default: (props: Record<string, any>) => {
    stepTwoProps = props
    return (
      <div data-testid="step-two">
        <span data-testid="step-two-is-api-key-set">{String(props.isAPIKeySet)}</span>
        <span data-testid="step-two-data-source-type">{props.dataSourceType}</span>
        <span data-testid="step-two-files-count">{props.files?.length || 0}</span>
        <button data-testid="step-two-prev" onClick={() => props.onStepChange(-1)}>Prev Step</button>
        <button data-testid="step-two-next" onClick={() => props.onStepChange(1)}>Next Step</button>
        <button data-testid="step-two-setting" onClick={props.onSetting}>Open Settings</button>
        <button
          data-testid="step-two-update-indexing-cache"
          onClick={() => props.updateIndexingTypeCache('high_quality')}
        >
          Update Indexing Cache
        </button>
        <button
          data-testid="step-two-update-retrieval-cache"
          onClick={() => props.updateRetrievalMethodCache('semantic_search')}
        >
          Update Retrieval Cache
        </button>
        <button
          data-testid="step-two-update-result-cache"
          onClick={() => props.updateResultCache({ batch: 'batch-1', documents: [] })}
        >
          Update Result Cache
        </button>
      </div>
    )
  },
}))

vi.mock('./step-three', () => ({
  default: (props: Record<string, any>) => {
    stepThreeProps = props
    return (
      <div data-testid="step-three">
        <span data-testid="step-three-dataset-id">{props.datasetId || 'none'}</span>
        <span data-testid="step-three-dataset-name">{props.datasetName || 'none'}</span>
        <span data-testid="step-three-indexing-type">{props.indexingType || 'none'}</span>
        <span data-testid="step-three-retrieval-method">{props.retrievalMethod || 'none'}</span>
      </div>
    )
  },
}))

vi.mock('./top-bar', () => ({
  TopBar: (props: Record<string, any>) => {
    _topBarProps = props
    return (
      <div data-testid="top-bar">
        <span data-testid="top-bar-active-index">{props.activeIndex}</span>
        <span data-testid="top-bar-dataset-id">{props.datasetId || 'none'}</span>
      </div>
    )
  },
}))

// ==========================================
// Test Data Builders
// ==========================================

const createMockDataset = (overrides?: Partial<DataSet>): DataSet => ({
  id: 'dataset-123',
  name: 'Test Dataset',
  indexing_status: 'completed',
  icon_info: { icon: '', icon_background: '', icon_type: 'emoji' as const },
  description: 'Test description',
  permission: DatasetPermission.onlyMe,
  data_source_type: DataSourceType.FILE,
  indexing_technique: IndexingTypeValues.QUALIFIED as any,
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: Date.now(),
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 0,
  total_document_count: 0,
  word_count: 0,
  provider: 'openai',
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  embedding_available: true,
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_mode: undefined,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    weights: undefined,
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  retrieval_model: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_mode: undefined,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    weights: undefined,
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  tags: [],
  external_knowledge_info: {
    external_knowledge_id: '',
    external_knowledge_api_id: '',
    external_knowledge_api_name: '',
    external_knowledge_api_endpoint: '',
  },
  external_retrieval_model: {
    top_k: 3,
    score_threshold: 0.5,
    score_threshold_enabled: false,
  },
  built_in_field_enabled: false,
  runtime_mode: 'general' as const,
  enable_api: false,
  is_multimodal: false,
  ...overrides,
})

const createMockDataSourceAuth = (overrides?: Partial<DataSourceAuth>): DataSourceAuth => ({
  credential_id: 'cred-1',
  provider: 'notion',
  plugin_id: 'plugin-1',
  ...overrides,
} as DataSourceAuth)

// ==========================================
// Test Suite
// ==========================================

describe('DatasetUpdateForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock state
    mockDatasetDetail = undefined
    mockEmbeddingsDefaultModel = { model: 'text-embedding-ada-002', provider: 'openai' }
    mockDataSourceList = { result: [createMockDataSourceAuth()] }
    mockIsLoadingDataSourceList = false
    mockFetchingError = false
    // Reset captured props
    stepOneProps = {}
    stepTwoProps = {}
    stepThreeProps = {}
    _topBarProps = {}
  })

  // ==========================================
  // Rendering Tests - Verify component renders correctly in different states
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(screen.getByTestId('top-bar')).toBeInTheDocument()
      expect(screen.getByTestId('step-one')).toBeInTheDocument()
    })

    it('should render TopBar with correct active index for step 1', () => {
      // Arrange & Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(screen.getByTestId('top-bar-active-index')).toHaveTextContent('0')
    })

    it('should render StepOne by default', () => {
      // Arrange & Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(screen.getByTestId('step-one')).toBeInTheDocument()
      expect(screen.queryByTestId('step-two')).not.toBeInTheDocument()
      expect(screen.queryByTestId('step-three')).not.toBeInTheDocument()
    })

    it('should show loading state when data source list is loading', () => {
      // Arrange
      mockIsLoadingDataSourceList = true

      // Act
      render(<DatasetUpdateForm />)

      // Assert - Loading component should be rendered (not the steps)
      expect(screen.queryByTestId('step-one')).not.toBeInTheDocument()
    })

    it('should show error state when fetching fails', () => {
      // Arrange
      mockFetchingError = true

      // Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(screen.getByText('datasetCreation.error.unavailable')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing - Verify datasetId prop behavior
  // ==========================================
  describe('Props', () => {
    describe('datasetId prop', () => {
      it('should pass datasetId to TopBar', () => {
        // Arrange & Act
        render(<DatasetUpdateForm datasetId="dataset-abc" />)

        // Assert
        expect(screen.getByTestId('top-bar-dataset-id')).toHaveTextContent('dataset-abc')
      })

      it('should pass datasetId to StepOne', () => {
        // Arrange & Act
        render(<DatasetUpdateForm datasetId="dataset-abc" />)

        // Assert
        expect(stepOneProps.datasetId).toBe('dataset-abc')
      })

      it('should render without datasetId', () => {
        // Arrange & Act
        render(<DatasetUpdateForm />)

        // Assert
        expect(screen.getByTestId('top-bar-dataset-id')).toHaveTextContent('none')
        expect(stepOneProps.datasetId).toBeUndefined()
      })
    })
  })

  // ==========================================
  // State Management - Test state initialization and transitions
  // ==========================================
  describe('State Management', () => {
    describe('dataSourceType state', () => {
      it('should initialize with FILE data source type', () => {
        // Arrange & Act
        render(<DatasetUpdateForm />)

        // Assert
        expect(screen.getByTestId('step-one-data-source-type')).toHaveTextContent(DataSourceType.FILE)
      })

      it('should update dataSourceType when changeType is called', () => {
        // Arrange
        render(<DatasetUpdateForm />)

        // Act
        fireEvent.click(screen.getByTestId('step-one-change-type'))

        // Assert
        expect(screen.getByTestId('step-one-data-source-type')).toHaveTextContent(DataSourceType.NOTION)
      })
    })

    describe('step state', () => {
      it('should initialize at step 1', () => {
        // Arrange & Act
        render(<DatasetUpdateForm />)

        // Assert
        expect(screen.getByTestId('step-one')).toBeInTheDocument()
        expect(screen.getByTestId('top-bar-active-index')).toHaveTextContent('0')
      })

      it('should transition to step 2 when nextStep is called', () => {
        // Arrange
        render(<DatasetUpdateForm />)

        // Act
        fireEvent.click(screen.getByTestId('step-one-next'))

        // Assert
        expect(screen.queryByTestId('step-one')).not.toBeInTheDocument()
        expect(screen.getByTestId('step-two')).toBeInTheDocument()
        expect(screen.getByTestId('top-bar-active-index')).toHaveTextContent('1')
      })

      it('should transition to step 3 from step 2', () => {
        // Arrange
        render(<DatasetUpdateForm />)

        // First go to step 2
        fireEvent.click(screen.getByTestId('step-one-next'))

        // Act - go to step 3
        fireEvent.click(screen.getByTestId('step-two-next'))

        // Assert
        expect(screen.queryByTestId('step-two')).not.toBeInTheDocument()
        expect(screen.getByTestId('step-three')).toBeInTheDocument()
        expect(screen.getByTestId('top-bar-active-index')).toHaveTextContent('2')
      })

      it('should go back to step 1 from step 2', () => {
        // Arrange
        render(<DatasetUpdateForm />)
        fireEvent.click(screen.getByTestId('step-one-next'))

        // Act
        fireEvent.click(screen.getByTestId('step-two-prev'))

        // Assert
        expect(screen.getByTestId('step-one')).toBeInTheDocument()
        expect(screen.queryByTestId('step-two')).not.toBeInTheDocument()
      })
    })

    describe('fileList state', () => {
      it('should initialize with empty file list', () => {
        // Arrange & Act
        render(<DatasetUpdateForm />)

        // Assert
        expect(screen.getByTestId('step-one-files-count')).toHaveTextContent('0')
      })

      it('should update file list when updateFileList is called', () => {
        // Arrange
        render(<DatasetUpdateForm />)

        // Act
        fireEvent.click(screen.getByTestId('step-one-update-files'))

        // Assert
        expect(screen.getByTestId('step-one-files-count')).toHaveTextContent('1')
      })
    })

    describe('notionPages state', () => {
      it('should initialize with empty notion pages', () => {
        // Arrange & Act
        render(<DatasetUpdateForm />)

        // Assert
        expect(screen.getByTestId('step-one-notion-pages-count')).toHaveTextContent('0')
      })

      it('should update notion pages when updateNotionPages is called', () => {
        // Arrange
        render(<DatasetUpdateForm />)

        // Act
        fireEvent.click(screen.getByTestId('step-one-update-notion-pages'))

        // Assert
        expect(screen.getByTestId('step-one-notion-pages-count')).toHaveTextContent('1')
      })
    })

    describe('websitePages state', () => {
      it('should initialize with empty website pages', () => {
        // Arrange & Act
        render(<DatasetUpdateForm />)

        // Assert
        expect(screen.getByTestId('step-one-website-pages-count')).toHaveTextContent('0')
      })

      it('should update website pages when setWebsitePages is called', () => {
        // Arrange
        render(<DatasetUpdateForm />)

        // Act
        fireEvent.click(screen.getByTestId('step-one-update-website-pages'))

        // Assert
        expect(screen.getByTestId('step-one-website-pages-count')).toHaveTextContent('1')
      })
    })
  })

  // ==========================================
  // Callback Stability - Test memoization of callbacks
  // ==========================================
  describe('Callback Stability and Memoization', () => {
    it('should provide stable updateNotionPages callback reference', () => {
      // Arrange
      const { rerender } = render(<DatasetUpdateForm />)
      const initialCallback = stepOneProps.updateNotionPages

      // Act - trigger a rerender
      rerender(<DatasetUpdateForm />)

      // Assert - callback reference should be the same due to useCallback
      expect(stepOneProps.updateNotionPages).toBe(initialCallback)
    })

    it('should provide stable updateNotionCredentialId callback reference', () => {
      // Arrange
      const { rerender } = render(<DatasetUpdateForm />)
      const initialCallback = stepOneProps.updateNotionCredentialId

      // Act
      rerender(<DatasetUpdateForm />)

      // Assert
      expect(stepOneProps.updateNotionCredentialId).toBe(initialCallback)
    })

    it('should provide stable updateFileList callback reference', () => {
      // Arrange
      const { rerender } = render(<DatasetUpdateForm />)
      const initialCallback = stepOneProps.updateFileList

      // Act
      rerender(<DatasetUpdateForm />)

      // Assert
      expect(stepOneProps.updateFileList).toBe(initialCallback)
    })

    it('should provide stable updateFile callback reference', () => {
      // Arrange
      const { rerender } = render(<DatasetUpdateForm />)
      const initialCallback = stepOneProps.updateFile

      // Act
      rerender(<DatasetUpdateForm />)

      // Assert
      expect(stepOneProps.updateFile).toBe(initialCallback)
    })

    it('should provide stable updateIndexingTypeCache callback reference', () => {
      // Arrange
      const { rerender } = render(<DatasetUpdateForm />)
      fireEvent.click(screen.getByTestId('step-one-next'))
      const initialCallback = stepTwoProps.updateIndexingTypeCache

      // Act - trigger a rerender without changing step
      rerender(<DatasetUpdateForm />)

      // Assert - callbacks with same dependencies should be stable
      expect(stepTwoProps.updateIndexingTypeCache).toBe(initialCallback)
    })
  })

  // ==========================================
  // User Interactions - Test event handlers
  // ==========================================
  describe('User Interactions', () => {
    it('should open account settings when onSetting is called from StepOne', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-setting'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: 'data-source' })
    })

    it('should open provider settings when onSetting is called from StepTwo', () => {
      // Arrange
      render(<DatasetUpdateForm />)
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Act
      fireEvent.click(screen.getByTestId('step-two-setting'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: 'provider' })
    })

    it('should update crawl options when onCrawlOptionsChange is called', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-update-crawl-options'))

      // Assert
      expect(stepOneProps.crawlOptions.limit).toBe(20)
    })

    it('should update crawl provider when onWebsiteCrawlProviderChange is called', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-update-crawl-provider'))

      // Assert - Need to verify state through StepTwo props
      fireEvent.click(screen.getByTestId('step-one-next'))
      expect(stepTwoProps.websiteCrawlProvider).toBe(DataSourceProvider.fireCrawl)
    })

    it('should update job id when onWebsiteCrawlJobIdChange is called', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-update-job-id'))

      // Assert - Verify through StepTwo props
      fireEvent.click(screen.getByTestId('step-one-next'))
      expect(stepTwoProps.websiteCrawlJobId).toBe('job-123')
    })

    it('should update file progress correctly using immer produce', () => {
      // Arrange
      render(<DatasetUpdateForm />)
      fireEvent.click(screen.getByTestId('step-one-update-files'))

      // Act
      fireEvent.click(screen.getByTestId('step-one-update-file-progress'))

      // Assert - Progress should be updated
      expect(stepOneProps.files[0].progress).toBe(50)
    })

    it('should update notion credential id', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-update-notion-credential'))

      // Assert
      expect(stepOneProps.notionCredentialId).toBe('credential-123')
    })
  })

  // ==========================================
  // Step Two Specific Tests
  // ==========================================
  describe('StepTwo Rendering and Props', () => {
    it('should pass isAPIKeySet as true when embeddingsDefaultModel exists', () => {
      // Arrange
      mockEmbeddingsDefaultModel = { model: 'model-1', provider: 'openai' }
      render(<DatasetUpdateForm />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert
      expect(screen.getByTestId('step-two-is-api-key-set')).toHaveTextContent('true')
    })

    it('should pass isAPIKeySet as false when embeddingsDefaultModel is undefined', () => {
      // Arrange
      mockEmbeddingsDefaultModel = undefined
      render(<DatasetUpdateForm />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert
      expect(screen.getByTestId('step-two-is-api-key-set')).toHaveTextContent('false')
    })

    it('should pass correct dataSourceType to StepTwo', () => {
      // Arrange
      render(<DatasetUpdateForm />)
      fireEvent.click(screen.getByTestId('step-one-change-type'))

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert
      expect(screen.getByTestId('step-two-data-source-type')).toHaveTextContent(DataSourceType.NOTION)
    })

    it('should pass files mapped to file property to StepTwo', () => {
      // Arrange
      render(<DatasetUpdateForm />)
      fireEvent.click(screen.getByTestId('step-one-update-files'))

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert
      expect(screen.getByTestId('step-two-files-count')).toHaveTextContent('1')
    })

    it('should update indexing type cache from StepTwo', () => {
      // Arrange
      render(<DatasetUpdateForm />)
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Act
      fireEvent.click(screen.getByTestId('step-two-update-indexing-cache'))

      // Assert - Go to step 3 and verify
      fireEvent.click(screen.getByTestId('step-two-next'))
      expect(screen.getByTestId('step-three-indexing-type')).toHaveTextContent('high_quality')
    })

    it('should update retrieval method cache from StepTwo', () => {
      // Arrange
      render(<DatasetUpdateForm />)
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Act
      fireEvent.click(screen.getByTestId('step-two-update-retrieval-cache'))

      // Assert - Go to step 3 and verify
      fireEvent.click(screen.getByTestId('step-two-next'))
      expect(screen.getByTestId('step-three-retrieval-method')).toHaveTextContent('semantic_search')
    })

    it('should update result cache from StepTwo', () => {
      // Arrange
      render(<DatasetUpdateForm />)
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Act
      fireEvent.click(screen.getByTestId('step-two-update-result-cache'))

      // Assert - Go to step 3 and verify creationCache is passed
      fireEvent.click(screen.getByTestId('step-two-next'))
      expect(stepThreeProps.creationCache).toBeDefined()
      expect(stepThreeProps.creationCache?.batch).toBe('batch-1')
    })
  })

  // ==========================================
  // Step Two with datasetId and datasetDetail
  // ==========================================
  describe('StepTwo with existing dataset', () => {
    it('should not render StepTwo when datasetId exists but datasetDetail is undefined', () => {
      // Arrange
      mockDatasetDetail = undefined
      render(<DatasetUpdateForm datasetId="dataset-123" />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert - StepTwo should not render due to condition
      expect(screen.queryByTestId('step-two')).not.toBeInTheDocument()
    })

    it('should render StepTwo when datasetId exists and datasetDetail is defined', () => {
      // Arrange
      mockDatasetDetail = createMockDataset()
      render(<DatasetUpdateForm datasetId="dataset-123" />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert
      expect(screen.getByTestId('step-two')).toBeInTheDocument()
    })

    it('should pass indexingType from datasetDetail to StepTwo', () => {
      // Arrange
      mockDatasetDetail = createMockDataset({ indexing_technique: IndexingTypeValues.ECONOMICAL as any })
      render(<DatasetUpdateForm datasetId="dataset-123" />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert
      expect(stepTwoProps.indexingType).toBe('economy')
    })
  })

  // ==========================================
  // Step Three Tests
  // ==========================================
  describe('StepThree Rendering and Props', () => {
    it('should pass datasetId to StepThree', () => {
      // Arrange - Need datasetDetail for StepTwo to render when datasetId exists
      mockDatasetDetail = createMockDataset()
      render(<DatasetUpdateForm datasetId="dataset-456" />)

      // Act - Navigate to step 3
      fireEvent.click(screen.getByTestId('step-one-next'))
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert
      expect(screen.getByTestId('step-three-dataset-id')).toHaveTextContent('dataset-456')
    })

    it('should pass datasetName from datasetDetail to StepThree', () => {
      // Arrange
      mockDatasetDetail = createMockDataset({ name: 'My Special Dataset' })
      render(<DatasetUpdateForm datasetId="dataset-123" />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert
      expect(screen.getByTestId('step-three-dataset-name')).toHaveTextContent('My Special Dataset')
    })

    it('should use cached indexing type when datasetDetail indexing_technique is not available', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Navigate to step 2 and set cache
      fireEvent.click(screen.getByTestId('step-one-next'))
      fireEvent.click(screen.getByTestId('step-two-update-indexing-cache'))

      // Act - Navigate to step 3
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert
      expect(screen.getByTestId('step-three-indexing-type')).toHaveTextContent('high_quality')
    })

    it('should use datasetDetail indexing_technique over cached value', () => {
      // Arrange
      mockDatasetDetail = createMockDataset({ indexing_technique: IndexingTypeValues.ECONOMICAL as any })
      render(<DatasetUpdateForm datasetId="dataset-123" />)

      // Navigate to step 2 and set different cache
      fireEvent.click(screen.getByTestId('step-one-next'))
      fireEvent.click(screen.getByTestId('step-two-update-indexing-cache'))

      // Act - Navigate to step 3
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert - Should use datasetDetail value, not cache
      expect(screen.getByTestId('step-three-indexing-type')).toHaveTextContent('economy')
    })

    it('should use retrieval method from datasetDetail when available', () => {
      // Arrange
      mockDatasetDetail = createMockDataset()
      mockDatasetDetail.retrieval_model_dict = {
        ...mockDatasetDetail.retrieval_model_dict,
        search_method: RETRIEVE_METHOD.fullText,
      }
      render(<DatasetUpdateForm datasetId="dataset-123" />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert
      expect(screen.getByTestId('step-three-retrieval-method')).toHaveTextContent('full_text_search')
    })
  })

  // ==========================================
  // StepOne Props Tests
  // ==========================================
  describe('StepOne Props', () => {
    it('should pass authedDataSourceList from hook response', () => {
      // Arrange
      const mockAuth = createMockDataSourceAuth({ provider: 'google-drive' })
      mockDataSourceList = { result: [mockAuth] }

      // Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(stepOneProps.authedDataSourceList).toEqual([mockAuth])
    })

    it('should pass empty array when dataSourceList is undefined', () => {
      // Arrange
      mockDataSourceList = undefined

      // Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(stepOneProps.authedDataSourceList).toEqual([])
    })

    it('should pass dataSourceTypeDisable as true when datasetDetail has data_source_type', () => {
      // Arrange
      mockDatasetDetail = createMockDataset({ data_source_type: DataSourceType.FILE })

      // Act
      render(<DatasetUpdateForm datasetId="dataset-123" />)

      // Assert
      expect(stepOneProps.dataSourceTypeDisable).toBe(true)
    })

    it('should pass dataSourceTypeDisable as false when datasetDetail is undefined', () => {
      // Arrange
      mockDatasetDetail = undefined

      // Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(stepOneProps.dataSourceTypeDisable).toBe(false)
    })

    it('should pass default crawl options', () => {
      // Arrange & Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(stepOneProps.crawlOptions).toEqual({
        crawl_sub_pages: true,
        only_main_content: true,
        includes: '',
        excludes: '',
        limit: 10,
        max_depth: '',
        use_sitemap: true,
      })
    })
  })

  // ==========================================
  // Edge Cases - Test boundary conditions and error handling
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle empty data source list', () => {
      // Arrange
      mockDataSourceList = { result: [] }

      // Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(stepOneProps.authedDataSourceList).toEqual([])
    })

    it('should handle undefined datasetDetail retrieval_model_dict', () => {
      // Arrange
      mockDatasetDetail = createMockDataset()
      // @ts-expect-error - Testing undefined case
      mockDatasetDetail.retrieval_model_dict = undefined
      render(<DatasetUpdateForm datasetId="dataset-123" />)

      // Act
      fireEvent.click(screen.getByTestId('step-one-next'))
      fireEvent.click(screen.getByTestId('step-two-update-retrieval-cache'))
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert - Should use cached value
      expect(screen.getByTestId('step-three-retrieval-method')).toHaveTextContent('semantic_search')
    })

    it('should handle step state correctly after multiple navigations', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Act - Navigate forward and back multiple times
      fireEvent.click(screen.getByTestId('step-one-next')) // to step 2
      fireEvent.click(screen.getByTestId('step-two-prev')) // back to step 1
      fireEvent.click(screen.getByTestId('step-one-next')) // to step 2
      fireEvent.click(screen.getByTestId('step-two-next')) // to step 3

      // Assert
      expect(screen.getByTestId('step-three')).toBeInTheDocument()
      expect(screen.getByTestId('top-bar-active-index')).toHaveTextContent('2')
    })

    it('should handle result cache being undefined', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Act - Navigate to step 3 without setting result cache
      fireEvent.click(screen.getByTestId('step-one-next'))
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert
      expect(stepThreeProps.creationCache).toBeUndefined()
    })

    it('should pass result cache to step three', async () => {
      // Arrange
      render(<DatasetUpdateForm />)
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Set result cache value
      fireEvent.click(screen.getByTestId('step-two-update-result-cache'))

      // Navigate to step 3
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert - Result cache is correctly passed to step three
      expect(stepThreeProps.creationCache).toBeDefined()
      expect(stepThreeProps.creationCache?.batch).toBe('batch-1')
    })

    it('should preserve state when navigating between steps', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Set up various states
      fireEvent.click(screen.getByTestId('step-one-change-type'))
      fireEvent.click(screen.getByTestId('step-one-update-files'))
      fireEvent.click(screen.getByTestId('step-one-update-notion-pages'))

      // Navigate to step 2 and back
      fireEvent.click(screen.getByTestId('step-one-next'))
      fireEvent.click(screen.getByTestId('step-two-prev'))

      // Assert - All state should be preserved
      expect(screen.getByTestId('step-one-data-source-type')).toHaveTextContent(DataSourceType.NOTION)
      expect(screen.getByTestId('step-one-files-count')).toHaveTextContent('1')
      expect(screen.getByTestId('step-one-notion-pages-count')).toHaveTextContent('1')
    })
  })

  // ==========================================
  // Integration Tests - Test complete flows
  // ==========================================
  describe('Integration', () => {
    it('should complete full flow from step 1 to step 3 with all state updates', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Step 1: Set up data
      fireEvent.click(screen.getByTestId('step-one-update-files'))
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Step 2: Set caches
      fireEvent.click(screen.getByTestId('step-two-update-indexing-cache'))
      fireEvent.click(screen.getByTestId('step-two-update-retrieval-cache'))
      fireEvent.click(screen.getByTestId('step-two-update-result-cache'))
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert - All data flows through to Step 3
      expect(screen.getByTestId('step-three-indexing-type')).toHaveTextContent('high_quality')
      expect(screen.getByTestId('step-three-retrieval-method')).toHaveTextContent('semantic_search')
      expect(stepThreeProps.creationCache?.batch).toBe('batch-1')
    })

    it('should handle complete website crawl workflow', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Set website data source through button click
      fireEvent.click(screen.getByTestId('step-one-update-website-pages'))
      fireEvent.click(screen.getByTestId('step-one-update-crawl-options'))
      fireEvent.click(screen.getByTestId('step-one-update-crawl-provider'))
      fireEvent.click(screen.getByTestId('step-one-update-job-id'))

      // Navigate to step 2
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert - All website data passed to StepTwo
      expect(stepTwoProps.websitePages.length).toBe(1)
      expect(stepTwoProps.websiteCrawlProvider).toBe(DataSourceProvider.fireCrawl)
      expect(stepTwoProps.websiteCrawlJobId).toBe('job-123')
      expect(stepTwoProps.crawlOptions.limit).toBe(20)
    })

    it('should handle complete notion workflow', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Set notion data source
      fireEvent.click(screen.getByTestId('step-one-change-type'))
      fireEvent.click(screen.getByTestId('step-one-update-notion-pages'))
      fireEvent.click(screen.getByTestId('step-one-update-notion-credential'))

      // Navigate to step 2
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert
      expect(stepTwoProps.notionPages.length).toBe(1)
      expect(stepTwoProps.notionCredentialId).toBe('credential-123')
    })

    it('should handle edit mode with existing dataset', () => {
      // Arrange
      mockDatasetDetail = createMockDataset({
        name: 'Existing Dataset',
        indexing_technique: IndexingTypeValues.QUALIFIED as any,
        data_source_type: DataSourceType.NOTION,
      })
      render(<DatasetUpdateForm datasetId="dataset-123" />)

      // Assert - Step 1 should have disabled data source type
      expect(stepOneProps.dataSourceTypeDisable).toBe(true)

      // Navigate through
      fireEvent.click(screen.getByTestId('step-one-next'))

      // Assert - Step 2 should receive dataset info
      expect(stepTwoProps.indexingType).toBe('high_quality')
      expect(stepTwoProps.datasetId).toBe('dataset-123')

      // Navigate to Step 3
      fireEvent.click(screen.getByTestId('step-two-next'))

      // Assert - Step 3 should show dataset details
      expect(screen.getByTestId('step-three-dataset-name')).toHaveTextContent('Existing Dataset')
      expect(screen.getByTestId('step-three-indexing-type')).toHaveTextContent('high_quality')
    })
  })

  // ==========================================
  // Default Crawl Options Tests
  // ==========================================
  describe('Default Crawl Options', () => {
    it('should have correct default crawl options structure', () => {
      // Arrange & Act
      render(<DatasetUpdateForm />)

      // Assert
      const crawlOptions = stepOneProps.crawlOptions
      expect(crawlOptions).toMatchObject({
        crawl_sub_pages: true,
        only_main_content: true,
        includes: '',
        excludes: '',
        limit: 10,
        max_depth: '',
        use_sitemap: true,
      })
    })

    it('should preserve crawl options when navigating steps', () => {
      // Arrange
      render(<DatasetUpdateForm />)

      // Update crawl options
      fireEvent.click(screen.getByTestId('step-one-update-crawl-options'))

      // Navigate to step 2 and back
      fireEvent.click(screen.getByTestId('step-one-next'))
      fireEvent.click(screen.getByTestId('step-two-prev'))

      // Assert
      expect(stepOneProps.crawlOptions.limit).toBe(20)
    })
  })

  // ==========================================
  // Error State Tests
  // ==========================================
  describe('Error States', () => {
    it('should display error message when fetching data source list fails', () => {
      // Arrange
      mockFetchingError = true

      // Act
      render(<DatasetUpdateForm />)

      // Assert
      const errorElement = screen.getByText('datasetCreation.error.unavailable')
      expect(errorElement).toBeInTheDocument()
    })

    it('should not render steps when in error state', () => {
      // Arrange
      mockFetchingError = true

      // Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(screen.queryByTestId('step-one')).not.toBeInTheDocument()
      expect(screen.queryByTestId('step-two')).not.toBeInTheDocument()
      expect(screen.queryByTestId('step-three')).not.toBeInTheDocument()
    })

    it('should render error page with 500 code when in error state', () => {
      // Arrange
      mockFetchingError = true

      // Act
      render(<DatasetUpdateForm />)

      // Assert - Error state renders AppUnavailable, not the normal layout
      expect(screen.getByText('500')).toBeInTheDocument()
      expect(screen.queryByTestId('top-bar')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Loading State Tests
  // ==========================================
  describe('Loading States', () => {
    it('should not render steps while loading', () => {
      // Arrange
      mockIsLoadingDataSourceList = true

      // Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(screen.queryByTestId('step-one')).not.toBeInTheDocument()
    })

    it('should render TopBar while loading', () => {
      // Arrange
      mockIsLoadingDataSourceList = true

      // Act
      render(<DatasetUpdateForm />)

      // Assert
      expect(screen.getByTestId('top-bar')).toBeInTheDocument()
    })

    it('should render StepOne after loading completes', async () => {
      // Arrange
      mockIsLoadingDataSourceList = true
      const { rerender } = render(<DatasetUpdateForm />)

      // Assert - Initially not rendered
      expect(screen.queryByTestId('step-one')).not.toBeInTheDocument()

      // Act - Loading completes
      mockIsLoadingDataSourceList = false
      rerender(<DatasetUpdateForm />)

      // Assert - Now rendered
      await waitFor(() => {
        expect(screen.getByTestId('step-one')).toBeInTheDocument()
      })
    })
  })
})
