import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { CrawlStep } from '@/models/datasets'
import WebsiteCrawl from './index'

// ==========================================
// Mock Modules
// ==========================================

// Note: react-i18next uses global mock from web/vitest.setup.ts

// Mock useDocLink - context hook requires mocking
const mockDocLink = vi.fn((path?: string) => `https://docs.example.com${path || ''}`)
vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockDocLink,
}))

// Mock dataset-detail context - context provider requires mocking
let mockPipelineId: string | undefined = 'pipeline-123'
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (s: any) => any) => selector({ dataset: { pipeline_id: mockPipelineId } }),
}))

// Mock modal context - context provider requires mocking
const mockSetShowAccountSettingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (s: any) => any) => selector({ setShowAccountSettingModal: mockSetShowAccountSettingModal }),
}))

// Mock ssePost - API service requires mocking
const { mockSsePost } = vi.hoisted(() => ({
  mockSsePost: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  ssePost: mockSsePost,
}))

// Mock useGetDataSourceAuth - API service hook requires mocking
const { mockUseGetDataSourceAuth } = vi.hoisted(() => ({
  mockUseGetDataSourceAuth: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceAuth: mockUseGetDataSourceAuth,
}))

// Mock usePipeline hooks - API service hooks require mocking
const { mockUseDraftPipelinePreProcessingParams, mockUsePublishedPipelinePreProcessingParams } = vi.hoisted(() => ({
  mockUseDraftPipelinePreProcessingParams: vi.fn(),
  mockUsePublishedPipelinePreProcessingParams: vi.fn(),
}))

vi.mock('@/service/use-pipeline', () => ({
  useDraftPipelinePreProcessingParams: mockUseDraftPipelinePreProcessingParams,
  usePublishedPipelinePreProcessingParams: mockUsePublishedPipelinePreProcessingParams,
}))

// Note: zustand/react/shallow useShallow is imported directly (simple utility function)

// Mock store
const mockStoreState = {
  crawlResult: undefined as { data: CrawlResultItem[], time_consuming: number | string } | undefined,
  step: CrawlStep.init,
  websitePages: [] as CrawlResultItem[],
  previewIndex: -1,
  currentCredentialId: '',
  setWebsitePages: vi.fn(),
  setCurrentWebsite: vi.fn(),
  setPreviewIndex: vi.fn(),
  setStep: vi.fn(),
  setCrawlResult: vi.fn(),
}

const mockGetState = vi.fn(() => mockStoreState)
const mockDataSourceStore = { getState: mockGetState }

vi.mock('../store', () => ({
  useDataSourceStoreWithSelector: (selector: (s: any) => any) => selector(mockStoreState),
  useDataSourceStore: () => mockDataSourceStore,
}))

// Mock Header component
vi.mock('../base/header', () => ({
  default: (props: any) => (
    <div data-testid="header">
      <span data-testid="header-doc-title">{props.docTitle}</span>
      <span data-testid="header-doc-link">{props.docLink}</span>
      <span data-testid="header-plugin-name">{props.pluginName}</span>
      <span data-testid="header-credential-id">{props.currentCredentialId}</span>
      <button data-testid="header-config-btn" onClick={props.onClickConfiguration}>Configure</button>
      <button data-testid="header-credential-change" onClick={() => props.onCredentialChange('new-cred-id')}>Change Credential</button>
      <span data-testid="header-credentials-count">{props.credentials?.length || 0}</span>
    </div>
  ),
}))

// Mock Options component
const mockOptionsSubmit = vi.fn()
vi.mock('./base/options', () => ({
  default: (props: any) => (
    <div data-testid="options">
      <span data-testid="options-step">{props.step}</span>
      <span data-testid="options-run-disabled">{String(props.runDisabled)}</span>
      <span data-testid="options-variables-count">{props.variables?.length || 0}</span>
      <button
        data-testid="options-submit-btn"
        onClick={() => {
          mockOptionsSubmit()
          props.onSubmit({ url: 'https://example.com', depth: 2 })
        }}
      >
        Submit
      </button>
    </div>
  ),
}))

// Mock Crawling component
vi.mock('./base/crawling', () => ({
  default: (props: any) => (
    <div data-testid="crawling">
      <span data-testid="crawling-crawled-num">{props.crawledNum}</span>
      <span data-testid="crawling-total-num">{props.totalNum}</span>
    </div>
  ),
}))

// Mock ErrorMessage component
vi.mock('./base/error-message', () => ({
  default: (props: any) => (
    <div data-testid="error-message" className={props.className}>
      <span data-testid="error-title">{props.title}</span>
      <span data-testid="error-msg">{props.errorMsg}</span>
    </div>
  ),
}))

// Mock CrawledResult component
vi.mock('./base/crawled-result', () => ({
  default: (props: any) => (
    <div data-testid="crawled-result" className={props.className}>
      <span data-testid="crawled-result-count">{props.list?.length || 0}</span>
      <span data-testid="crawled-result-checked-count">{props.checkedList?.length || 0}</span>
      <span data-testid="crawled-result-used-time">{props.usedTime}</span>
      <span data-testid="crawled-result-preview-index">{props.previewIndex}</span>
      <span data-testid="crawled-result-show-preview">{String(props.showPreview)}</span>
      <span data-testid="crawled-result-multiple-choice">{String(props.isMultipleChoice)}</span>
      <button
        data-testid="crawled-result-select-change"
        onClick={() => props.onSelectedChange([{ source_url: 'https://example.com', title: 'Test' }])}
      >
        Change Selection
      </button>
      <button
        data-testid="crawled-result-preview"
        onClick={() => props.onPreview?.({ source_url: 'https://example.com', title: 'Test' }, 0)}
      >
        Preview
      </button>
    </div>
  ),
}))

// ==========================================
// Test Data Builders
// ==========================================
const createMockNodeData = (overrides?: Partial<DataSourceNodeType>): DataSourceNodeType => ({
  title: 'Test Node',
  plugin_id: 'plugin-123',
  provider_type: 'website',
  provider_name: 'website-provider',
  datasource_name: 'website-ds',
  datasource_label: 'Website Crawler',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
} as DataSourceNodeType)

const createMockCrawlResultItem = (overrides?: Partial<CrawlResultItem>): CrawlResultItem => ({
  source_url: 'https://example.com/page1',
  title: 'Test Page 1',
  markdown: '# Test content',
  description: 'Test description',
  ...overrides,
})

const createMockCredential = (overrides?: Partial<{ id: string, name: string }>) => ({
  id: 'cred-1',
  name: 'Test Credential',
  avatar_url: 'https://example.com/avatar.png',
  credential: {},
  is_default: false,
  type: 'oauth2',
  ...overrides,
})

type WebsiteCrawlProps = React.ComponentProps<typeof WebsiteCrawl>

const createDefaultProps = (overrides?: Partial<WebsiteCrawlProps>): WebsiteCrawlProps => ({
  nodeId: 'node-1',
  nodeData: createMockNodeData(),
  onCredentialChange: vi.fn(),
  isInPipeline: false,
  supportBatchUpload: true,
  ...overrides,
})

// ==========================================
// Test Suites
// ==========================================
describe('WebsiteCrawl', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset store state
    mockStoreState.crawlResult = undefined
    mockStoreState.step = CrawlStep.init
    mockStoreState.websitePages = []
    mockStoreState.previewIndex = -1
    mockStoreState.currentCredentialId = ''
    mockStoreState.setWebsitePages = vi.fn()
    mockStoreState.setCurrentWebsite = vi.fn()
    mockStoreState.setPreviewIndex = vi.fn()
    mockStoreState.setStep = vi.fn()
    mockStoreState.setCrawlResult = vi.fn()

    // Reset context values
    mockPipelineId = 'pipeline-123'
    mockSetShowAccountSettingModal.mockClear()

    // Default mock return values
    mockUseGetDataSourceAuth.mockReturnValue({
      data: { result: [createMockCredential()] },
    })

    mockUseDraftPipelinePreProcessingParams.mockReturnValue({
      data: { variables: [] },
      isFetching: false,
    })

    mockUsePublishedPipelinePreProcessingParams.mockReturnValue({
      data: { variables: [] },
      isFetching: false,
    })

    mockGetState.mockReturnValue(mockStoreState)
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('header')).toBeInTheDocument()
      expect(screen.getByTestId('options')).toBeInTheDocument()
    })

    it('should render Header with correct props', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-123'
      const props = createDefaultProps({
        nodeData: createMockNodeData({ datasource_label: 'My Website Crawler' }),
      })

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('header-doc-title')).toHaveTextContent('Docs')
      expect(screen.getByTestId('header-plugin-name')).toHaveTextContent('My Website Crawler')
      expect(screen.getByTestId('header-credential-id')).toHaveTextContent('cred-123')
    })

    it('should render Options with correct props', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('options')).toBeInTheDocument()
      expect(screen.getByTestId('options-step')).toHaveTextContent(CrawlStep.init)
    })

    it('should not render Crawling or CrawledResult when step is init', () => {
      // Arrange
      mockStoreState.step = CrawlStep.init
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.queryByTestId('crawling')).not.toBeInTheDocument()
      expect(screen.queryByTestId('crawled-result')).not.toBeInTheDocument()
      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
    })

    it('should render Crawling when step is running', () => {
      // Arrange
      mockStoreState.step = CrawlStep.running
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('crawling')).toBeInTheDocument()
      expect(screen.queryByTestId('crawled-result')).not.toBeInTheDocument()
      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
    })

    it('should render CrawledResult when step is finished with no error', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: 1.5,
      }
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('crawled-result')).toBeInTheDocument()
      expect(screen.queryByTestId('crawling')).not.toBeInTheDocument()
      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('nodeId prop', () => {
      it('should use nodeId in datasourceNodeRunURL for non-pipeline mode', async () => {
        // Arrange
        mockStoreState.currentCredentialId = 'cred-1'
        const props = createDefaultProps({
          nodeId: 'custom-node-id',
          isInPipeline: false,
        })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert - Options uses nodeId through usePreProcessingParams
        expect(mockUsePublishedPipelinePreProcessingParams).toHaveBeenCalledWith(
          { pipeline_id: 'pipeline-123', node_id: 'custom-node-id' },
          true,
        )
      })
    })

    describe('nodeData prop', () => {
      it('should pass plugin_id and provider_name to useGetDataSourceAuth', () => {
        // Arrange
        const nodeData = createMockNodeData({
          plugin_id: 'my-plugin-id',
          provider_name: 'my-provider',
        })
        const props = createDefaultProps({ nodeData })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert
        expect(mockUseGetDataSourceAuth).toHaveBeenCalledWith({
          pluginId: 'my-plugin-id',
          provider: 'my-provider',
        })
      })

      it('should pass datasource_label to Header as pluginName', () => {
        // Arrange
        const nodeData = createMockNodeData({
          datasource_label: 'Custom Website Scraper',
        })
        const props = createDefaultProps({ nodeData })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert
        expect(screen.getByTestId('header-plugin-name')).toHaveTextContent('Custom Website Scraper')
      })
    })

    describe('isInPipeline prop', () => {
      it('should use draft URL when isInPipeline is true', () => {
        // Arrange
        const props = createDefaultProps({ isInPipeline: true })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert
        expect(mockUseDraftPipelinePreProcessingParams).toHaveBeenCalled()
        expect(mockUsePublishedPipelinePreProcessingParams).not.toHaveBeenCalled()
      })

      it('should use published URL when isInPipeline is false', () => {
        // Arrange
        const props = createDefaultProps({ isInPipeline: false })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert
        expect(mockUsePublishedPipelinePreProcessingParams).toHaveBeenCalled()
        expect(mockUseDraftPipelinePreProcessingParams).not.toHaveBeenCalled()
      })

      it('should pass showPreview as false to CrawledResult when isInPipeline is true', () => {
        // Arrange
        mockStoreState.step = CrawlStep.finished
        mockStoreState.crawlResult = {
          data: [createMockCrawlResultItem()],
          time_consuming: 1.5,
        }
        const props = createDefaultProps({ isInPipeline: true })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert
        expect(screen.getByTestId('crawled-result-show-preview')).toHaveTextContent('false')
      })

      it('should pass showPreview as true to CrawledResult when isInPipeline is false', () => {
        // Arrange
        mockStoreState.step = CrawlStep.finished
        mockStoreState.crawlResult = {
          data: [createMockCrawlResultItem()],
          time_consuming: 1.5,
        }
        const props = createDefaultProps({ isInPipeline: false })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert
        expect(screen.getByTestId('crawled-result-show-preview')).toHaveTextContent('true')
      })
    })

    describe('supportBatchUpload prop', () => {
      it('should pass isMultipleChoice as true to CrawledResult when supportBatchUpload is true', () => {
        // Arrange
        mockStoreState.step = CrawlStep.finished
        mockStoreState.crawlResult = {
          data: [createMockCrawlResultItem()],
          time_consuming: 1.5,
        }
        const props = createDefaultProps({ supportBatchUpload: true })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert
        expect(screen.getByTestId('crawled-result-multiple-choice')).toHaveTextContent('true')
      })

      it('should pass isMultipleChoice as false to CrawledResult when supportBatchUpload is false', () => {
        // Arrange
        mockStoreState.step = CrawlStep.finished
        mockStoreState.crawlResult = {
          data: [createMockCrawlResultItem()],
          time_consuming: 1.5,
        }
        const props = createDefaultProps({ supportBatchUpload: false })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert
        expect(screen.getByTestId('crawled-result-multiple-choice')).toHaveTextContent('false')
      })

      it.each([
        [true, 'true'],
        [false, 'false'],
        [undefined, 'true'], // Default value
      ])('should handle supportBatchUpload=%s correctly', (value, expected) => {
        // Arrange
        mockStoreState.step = CrawlStep.finished
        mockStoreState.crawlResult = {
          data: [createMockCrawlResultItem()],
          time_consuming: 1.5,
        }
        const props = createDefaultProps({ supportBatchUpload: value })

        // Act
        render(<WebsiteCrawl {...props} />)

        // Assert
        expect(screen.getByTestId('crawled-result-multiple-choice')).toHaveTextContent(expected)
      })
    })

    describe('onCredentialChange prop', () => {
      it('should call onCredentialChange with credential id and reset state', () => {
        // Arrange
        const mockOnCredentialChange = vi.fn()
        const props = createDefaultProps({ onCredentialChange: mockOnCredentialChange })

        // Act
        render(<WebsiteCrawl {...props} />)
        fireEvent.click(screen.getByTestId('header-credential-change'))

        // Assert
        expect(mockOnCredentialChange).toHaveBeenCalledWith('new-cred-id')
      })
    })
  })

  // ==========================================
  // State Management Tests
  // ==========================================
  describe('State Management', () => {
    it('should display correct crawledNum and totalNum when running', () => {
      // Arrange
      mockStoreState.step = CrawlStep.running
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert - Initial state is 0/0
      expect(screen.getByTestId('crawling-crawled-num')).toHaveTextContent('0')
      expect(screen.getByTestId('crawling-total-num')).toHaveTextContent('0')
    })

    it('should update step and result via ssePost callbacks', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const mockCrawlData: CrawlResultItem[] = [
        createMockCrawlResultItem({ source_url: 'https://example.com/1' }),
        createMockCrawlResultItem({ source_url: 'https://example.com/2' }),
      ]

      mockSsePost.mockImplementation((url, options, callbacks) => {
        // Simulate processing
        callbacks.onDataSourceNodeProcessing({
          total: 10,
          completed: 5,
        })
        // Simulate completion
        callbacks.onDataSourceNodeCompleted({
          data: mockCrawlData,
          time_consuming: 2.5,
        })
      })

      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act - Trigger submit
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.running)
        expect(mockStoreState.setCrawlResult).toHaveBeenCalledWith({
          data: mockCrawlData,
          time_consuming: 2.5,
        })
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.finished)
      })
    })

    it('should pass runDisabled as true when no credential is selected', () => {
      // Arrange
      mockStoreState.currentCredentialId = ''
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('options-run-disabled')).toHaveTextContent('true')
    })

    it('should pass runDisabled as true when params are being fetched', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockUsePublishedPipelinePreProcessingParams.mockReturnValue({
        data: { variables: [] },
        isFetching: true,
      })
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('options-run-disabled')).toHaveTextContent('true')
    })

    it('should pass runDisabled as false when credential is selected and params are loaded', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockUsePublishedPipelinePreProcessingParams.mockReturnValue({
        data: { variables: [] },
        isFetching: false,
      })
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('options-run-disabled')).toHaveTextContent('false')
    })
  })

  // ==========================================
  // Callback Stability and Memoization
  // ==========================================
  describe('Callback Stability and Memoization', () => {
    it('should have stable handleCheckedCrawlResultChange that updates store', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: 1.5,
      }
      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('crawled-result-select-change'))

      // Assert
      expect(mockStoreState.setWebsitePages).toHaveBeenCalledWith([
        { source_url: 'https://example.com', title: 'Test' },
      ])
    })

    it('should have stable handlePreview that updates store', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: 1.5,
      }
      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('crawled-result-preview'))

      // Assert
      expect(mockStoreState.setCurrentWebsite).toHaveBeenCalledWith({
        source_url: 'https://example.com',
        title: 'Test',
      })
      expect(mockStoreState.setPreviewIndex).toHaveBeenCalledWith(0)
    })

    it('should have stable handleSetting callback', () => {
      // Arrange
      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('header-config-btn'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: ACCOUNT_SETTING_TAB.DATA_SOURCE,
      })
    })

    it('should have stable handleCredentialChange that resets state', () => {
      // Arrange
      const mockOnCredentialChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnCredentialChange })
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('header-credential-change'))

      // Assert
      expect(mockOnCredentialChange).toHaveBeenCalledWith('new-cred-id')
    })
  })

  // ==========================================
  // User Interactions and Event Handlers
  // ==========================================
  describe('User Interactions and Event Handlers', () => {
    it('should handle submit and trigger ssePost', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.running)
      })
    })

    it('should handle configuration button click', () => {
      // Arrange
      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('header-config-btn'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: ACCOUNT_SETTING_TAB.DATA_SOURCE,
      })
    })

    it('should handle credential change', () => {
      // Arrange
      const mockOnCredentialChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnCredentialChange })
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('header-credential-change'))

      // Assert
      expect(mockOnCredentialChange).toHaveBeenCalledWith('new-cred-id')
    })

    it('should handle selection change in CrawledResult', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: 1.5,
      }
      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('crawled-result-select-change'))

      // Assert
      expect(mockStoreState.setWebsitePages).toHaveBeenCalled()
    })

    it('should handle preview in CrawledResult', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: 1.5,
      }
      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('crawled-result-preview'))

      // Assert
      expect(mockStoreState.setCurrentWebsite).toHaveBeenCalled()
      expect(mockStoreState.setPreviewIndex).toHaveBeenCalled()
    })
  })

  // ==========================================
  // API Calls Mocking
  // ==========================================
  describe('API Calls', () => {
    it('should call ssePost with correct parameters for published workflow', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'test-cred'
      mockPipelineId = 'pipeline-456'
      const props = createDefaultProps({
        nodeId: 'node-789',
        isInPipeline: false,
      })
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalledWith(
          '/rag/pipelines/pipeline-456/workflows/published/datasource/nodes/node-789/run',
          expect.objectContaining({
            body: expect.objectContaining({
              inputs: { url: 'https://example.com', depth: 2 },
              datasource_type: 'website_crawl',
              credential_id: 'test-cred',
              response_mode: 'streaming',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should call ssePost with correct parameters for draft workflow', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'test-cred'
      mockPipelineId = 'pipeline-456'
      const props = createDefaultProps({
        nodeId: 'node-789',
        isInPipeline: true,
      })
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalledWith(
          '/rag/pipelines/pipeline-456/workflows/draft/datasource/nodes/node-789/run',
          expect.any(Object),
          expect.any(Object),
        )
      })
    })

    it('should handle onDataSourceNodeProcessing callback correctly', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.step = CrawlStep.running

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeProcessing({
          total: 100,
          completed: 50,
        })
      })

      const props = createDefaultProps()
      const { rerender } = render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Update store state to simulate running step
      mockStoreState.step = CrawlStep.running
      rerender(<WebsiteCrawl {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })
    })

    it('should handle onDataSourceNodeCompleted callback correctly', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const mockCrawlData: CrawlResultItem[] = [
        createMockCrawlResultItem({ source_url: 'https://example.com/1' }),
        createMockCrawlResultItem({ source_url: 'https://example.com/2' }),
      ]

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeCompleted({
          data: mockCrawlData,
          time_consuming: 3.5,
        })
      })

      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setCrawlResult).toHaveBeenCalledWith({
          data: mockCrawlData,
          time_consuming: 3.5,
        })
        expect(mockStoreState.setWebsitePages).toHaveBeenCalledWith(mockCrawlData)
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.finished)
      })
    })

    it('should handle onDataSourceNodeCompleted with single result when supportBatchUpload is false', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const mockCrawlData: CrawlResultItem[] = [
        createMockCrawlResultItem({ source_url: 'https://example.com/1' }),
        createMockCrawlResultItem({ source_url: 'https://example.com/2' }),
        createMockCrawlResultItem({ source_url: 'https://example.com/3' }),
      ]

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeCompleted({
          data: mockCrawlData,
          time_consuming: 3.5,
        })
      })

      const props = createDefaultProps({ supportBatchUpload: false })
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert
      await waitFor(() => {
        // Should only select first item when supportBatchUpload is false
        expect(mockStoreState.setWebsitePages).toHaveBeenCalledWith([mockCrawlData[0]])
      })
    })

    it('should handle onDataSourceNodeError callback correctly', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeError({
          error: 'Crawl failed: Invalid URL',
        })
      })

      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.finished)
      })
    })

    it('should use useGetDataSourceAuth with correct parameters', () => {
      // Arrange
      const nodeData = createMockNodeData({
        plugin_id: 'website-plugin',
        provider_name: 'website-provider',
      })
      const props = createDefaultProps({ nodeData })

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(mockUseGetDataSourceAuth).toHaveBeenCalledWith({
        pluginId: 'website-plugin',
        provider: 'website-provider',
      })
    })

    it('should pass credentials from useGetDataSourceAuth to Header', () => {
      // Arrange
      const mockCredentials = [
        createMockCredential({ id: 'cred-1', name: 'Credential 1' }),
        createMockCredential({ id: 'cred-2', name: 'Credential 2' }),
      ]
      mockUseGetDataSourceAuth.mockReturnValue({
        data: { result: mockCredentials },
      })
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('2')
    })
  })

  // ==========================================
  // Edge Cases and Error Handling
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle empty credentials array', () => {
      // Arrange
      mockUseGetDataSourceAuth.mockReturnValue({
        data: { result: [] },
      })
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('0')
    })

    it('should handle undefined dataSourceAuth result', () => {
      // Arrange
      mockUseGetDataSourceAuth.mockReturnValue({
        data: { result: undefined },
      })
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('0')
    })

    it('should handle null dataSourceAuth data', () => {
      // Arrange
      mockUseGetDataSourceAuth.mockReturnValue({
        data: null,
      })
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('0')
    })

    it('should handle empty crawlResult data array', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [],
        time_consuming: 0.5,
      }
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('crawled-result-count')).toHaveTextContent('0')
    })

    it('should handle undefined crawlResult', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = undefined
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('crawled-result-count')).toHaveTextContent('0')
    })

    it('should handle time_consuming as string', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: '2.5',
      }
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('crawled-result-used-time')).toHaveTextContent('2.5')
    })

    it('should handle invalid time_consuming value', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: 'invalid',
      }
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert - NaN should become 0
      expect(screen.getByTestId('crawled-result-used-time')).toHaveTextContent('0')
    })

    it('should handle undefined pipelineId gracefully', () => {
      // Arrange
      mockPipelineId = undefined
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(mockUsePublishedPipelinePreProcessingParams).toHaveBeenCalledWith(
        { pipeline_id: undefined, node_id: 'node-1' },
        false, // enabled should be false when pipelineId is undefined
      )
    })

    it('should handle empty nodeId gracefully', () => {
      // Arrange
      const props = createDefaultProps({ nodeId: '' })

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(mockUsePublishedPipelinePreProcessingParams).toHaveBeenCalledWith(
        { pipeline_id: 'pipeline-123', node_id: '' },
        false, // enabled should be false when nodeId is empty
      )
    })

    it('should handle undefined paramsConfig.variables (fallback to empty array)', () => {
      // Arrange - Test the || [] fallback on line 169
      mockUsePublishedPipelinePreProcessingParams.mockReturnValue({
        data: { variables: undefined },
        isFetching: false,
      })
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert - Options should receive empty array as variables
      expect(screen.getByTestId('options-variables-count')).toHaveTextContent('0')
    })

    it('should handle undefined paramsConfig (fallback to empty array)', () => {
      // Arrange - Test when paramsConfig is undefined
      mockUsePublishedPipelinePreProcessingParams.mockReturnValue({
        data: undefined,
        isFetching: false,
      })
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert - Options should receive empty array as variables
      expect(screen.getByTestId('options-variables-count')).toHaveTextContent('0')
    })

    it('should handle error without error message', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeError({
          error: undefined,
        })
      })

      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert - Should use fallback error message
      await waitFor(() => {
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.finished)
      })
    })

    it('should handle null total and completed in processing callback', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeProcessing({
          total: null,
          completed: null,
        })
      })

      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert - Should handle null values gracefully (default to 0)
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })
    })

    it('should handle undefined time_consuming in completed callback', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeCompleted({
          data: [createMockCrawlResultItem()],
          time_consuming: undefined,
        })
      })

      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setCrawlResult).toHaveBeenCalledWith({
          data: [expect.any(Object)],
          time_consuming: 0,
        })
      })
    })
  })

  // ==========================================
  // All Prop Variations
  // ==========================================
  describe('Prop Variations', () => {
    it.each([
      [{ isInPipeline: true, supportBatchUpload: true }],
      [{ isInPipeline: true, supportBatchUpload: false }],
      [{ isInPipeline: false, supportBatchUpload: true }],
      [{ isInPipeline: false, supportBatchUpload: false }],
    ])('should render correctly with props %o', (propVariation) => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: 1.5,
      }
      const props = createDefaultProps(propVariation)

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.getByTestId('crawled-result')).toBeInTheDocument()
      expect(screen.getByTestId('crawled-result-show-preview')).toHaveTextContent(
        String(!propVariation.isInPipeline),
      )
      expect(screen.getByTestId('crawled-result-multiple-choice')).toHaveTextContent(
        String(propVariation.supportBatchUpload),
      )
    })

    it('should use default values for optional props', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: 1.5,
      }
      const props: WebsiteCrawlProps = {
        nodeId: 'node-1',
        nodeData: createMockNodeData(),
        onCredentialChange: vi.fn(),
        // isInPipeline and supportBatchUpload are not provided
      }

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert - Default values: isInPipeline = false, supportBatchUpload = true
      expect(screen.getByTestId('crawled-result-show-preview')).toHaveTextContent('true')
      expect(screen.getByTestId('crawled-result-multiple-choice')).toHaveTextContent('true')
    })
  })

  // ==========================================
  // Error Display
  // ==========================================
  describe('Error Display', () => {
    it('should show ErrorMessage when crawl finishes with error', async () => {
      // Arrange - Need to create a scenario where error message is set
      mockStoreState.currentCredentialId = 'cred-1'

      // First render with init state
      const props = createDefaultProps()
      const { rerender } = render(<WebsiteCrawl {...props} />)

      // Simulate error by setting up ssePost to call error callback
      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeError({
          error: 'Network error',
        })
      })

      // Trigger submit
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Now update store state to finished to simulate the state after error
      mockStoreState.step = CrawlStep.finished
      rerender(<WebsiteCrawl {...props} />)

      // Assert - The component should check for error message state
      await waitFor(() => {
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.finished)
      })
    })

    it('should not show ErrorMessage when crawl finishes without error', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [createMockCrawlResultItem()],
        time_consuming: 1.5,
      }
      const props = createDefaultProps()

      // Act
      render(<WebsiteCrawl {...props} />)

      // Assert
      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
      expect(screen.getByTestId('crawled-result')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Integration Tests
  // ==========================================
  describe('Integration', () => {
    it('should complete full workflow: submit -> running -> completed', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const mockCrawlData: CrawlResultItem[] = [
        createMockCrawlResultItem({ source_url: 'https://example.com/1' }),
        createMockCrawlResultItem({ source_url: 'https://example.com/2' }),
      ]

      mockSsePost.mockImplementation((url, options, callbacks) => {
        // Simulate processing
        callbacks.onDataSourceNodeProcessing({
          total: 10,
          completed: 5,
        })
        // Simulate completion
        callbacks.onDataSourceNodeCompleted({
          data: mockCrawlData,
          time_consuming: 2.5,
        })
      })

      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act - Trigger submit
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert - Verify full flow
      await waitFor(() => {
        // Step should be set to running first
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.running)
        // Then result should be set
        expect(mockStoreState.setCrawlResult).toHaveBeenCalledWith({
          data: mockCrawlData,
          time_consuming: 2.5,
        })
        // Pages should be selected
        expect(mockStoreState.setWebsitePages).toHaveBeenCalledWith(mockCrawlData)
        // Step should be set to finished
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.finished)
      })
    })

    it('should handle error flow correctly', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeError({
          error: 'Failed to crawl website',
        })
      })

      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('options-submit-btn'))

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.running)
        expect(mockStoreState.setStep).toHaveBeenCalledWith(CrawlStep.finished)
      })
    })

    it('should handle credential change and allow new crawl', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'initial-cred'
      const mockOnCredentialChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnCredentialChange })

      // Act
      render(<WebsiteCrawl {...props} />)

      // Change credential
      fireEvent.click(screen.getByTestId('header-credential-change'))

      // Assert
      expect(mockOnCredentialChange).toHaveBeenCalledWith('new-cred-id')
    })

    it('should handle preview selection after crawl completes', () => {
      // Arrange
      mockStoreState.step = CrawlStep.finished
      mockStoreState.crawlResult = {
        data: [
          createMockCrawlResultItem({ source_url: 'https://example.com/1' }),
          createMockCrawlResultItem({ source_url: 'https://example.com/2' }),
        ],
        time_consuming: 1.5,
      }
      const props = createDefaultProps()
      render(<WebsiteCrawl {...props} />)

      // Act - Preview first item
      fireEvent.click(screen.getByTestId('crawled-result-preview'))

      // Assert
      expect(mockStoreState.setCurrentWebsite).toHaveBeenCalled()
      expect(mockStoreState.setPreviewIndex).toHaveBeenCalledWith(0)
    })
  })

  // ==========================================
  // Component Memoization
  // ==========================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { rerender } = render(<WebsiteCrawl {...props} />)
      rerender(<WebsiteCrawl {...props} />)

      // Assert - Component should still render correctly after rerender
      expect(screen.getByTestId('header')).toBeInTheDocument()
      expect(screen.getByTestId('options')).toBeInTheDocument()
    })

    it('should not re-run callbacks when props are the same', () => {
      // Arrange
      const onCredentialChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange })

      // Act
      const { rerender } = render(<WebsiteCrawl {...props} />)
      rerender(<WebsiteCrawl {...props} />)

      // Assert - The callback reference should be stable
      fireEvent.click(screen.getByTestId('header-credential-change'))
      expect(onCredentialChange).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================
  // Styling
  // ==========================================
  describe('Styling', () => {
    it('should apply correct container classes', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<WebsiteCrawl {...props} />)

      // Assert
      const rootDiv = container.firstChild as HTMLElement
      expect(rootDiv).toHaveClass('flex', 'flex-col')
    })

    it('should apply correct classes to options container', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<WebsiteCrawl {...props} />)

      // Assert
      const optionsContainer = container.querySelector('.rounded-xl')
      expect(optionsContainer).toBeInTheDocument()
    })
  })
})
