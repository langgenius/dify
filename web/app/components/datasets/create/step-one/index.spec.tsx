import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { NotionPage } from '@/models/common'
import type { CrawlOptions, CrawlResultItem, FileItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { DataSourceType } from '@/models/datasets'
import StepOne from './index'

// ==========================================
// Mock External Dependencies
// ==========================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock dataset detail context
let mockDatasetDetail: { data_source_type?: DataSourceType } | undefined
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: typeof mockDatasetDetail }) => unknown) => {
    const state = { dataset: mockDatasetDetail }
    return selector(state)
  },
}))

// Mock provider context
let mockPlanType: Plan = Plan.sandbox
let mockEnableBilling = false
let mockVectorSpaceUsage = 1
let mockVectorSpaceTotal = 10
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: {
      type: mockPlanType,
      usage: { vectorSpace: mockVectorSpaceUsage },
      total: { vectorSpace: mockVectorSpaceTotal },
    },
    enableBilling: mockEnableBilling,
  }),
}))

// Mock config for web crawl features (required by DataSourceSelector)
vi.mock('@/config', () => ({
  ENABLE_WEBSITE_FIRECRAWL: true,
  ENABLE_WEBSITE_JINAREADER: true,
  ENABLE_WEBSITE_WATERCRAWL: false,
}))

// ==========================================
// Mock Child Components with API Dependencies
// ==========================================

// Track props passed to child components for verification
let fileSourceProps: Record<string, unknown> = {}
let notionSourceProps: Record<string, unknown> = {}
let webSourceProps: Record<string, unknown> = {}

// Mock sources components (they have complex dependencies: FileUploader, NotionPageSelector, Website)
vi.mock('./sources', () => ({
  FileSource: (props: Record<string, unknown>) => {
    fileSourceProps = props
    return (
      <div data-testid="file-source">
        <button data-testid="file-source-next" onClick={props.onStepChange as () => void}>Next</button>
        <button data-testid="file-source-preview" onClick={() => (props.onPreview as (f: File) => void)(new File([''], 'test.txt'))}>Preview File</button>
      </div>
    )
  },
  NotionSource: (props: Record<string, unknown>) => {
    notionSourceProps = props
    return (
      <div data-testid="notion-source">
        <button data-testid="notion-source-next" onClick={props.onStepChange as () => void}>Next</button>
        <button data-testid="notion-source-preview" onClick={() => (props.onPreview as (p: NotionPage) => void)({ page_id: 'page-1', page_name: 'Test Page', parent_id: '', type: 'page', is_bound: false, page_icon: null, workspace_id: 'ws-1' })}>Preview Notion</button>
      </div>
    )
  },
  WebSource: (props: Record<string, unknown>) => {
    webSourceProps = props
    return (
      <div data-testid="web-source">
        <button data-testid="web-source-next" onClick={props.onStepChange as () => void}>Next</button>
        <button data-testid="web-source-preview" onClick={() => (props.onPreview as (w: CrawlResultItem) => void)({ title: 'Test', markdown: '', description: '', source_url: 'https://test.com' })}>Preview Website</button>
      </div>
    )
  },
}))

// NOTE: DataSourceSelector is imported directly (no API dependencies)
// NOTE: WebsitePreview is imported directly (no API dependencies)

// Mock components with API service dependencies
vi.mock('../empty-dataset-creation-modal', () => ({
  __esModule: true,
  default: ({ show, onHide }: { show: boolean, onHide: () => void }) => (
    show ? <div data-testid="empty-dataset-modal"><button onClick={onHide}>Close</button></div> : null
  ),
}))

// Mock FilePreview (depends on fetchFilePreview service)
vi.mock('../file-preview', () => ({
  __esModule: true,
  default: ({ file, hidePreview }: { file: File, hidePreview: () => void }) => (
    <div data-testid="file-preview">
      <span data-testid="file-preview-name">{file.name}</span>
      <button data-testid="file-preview-close" onClick={hidePreview}>Close</button>
    </div>
  ),
}))

// Mock NotionPagePreview (depends on fetchNotionPagePreview service)
vi.mock('../notion-page-preview', () => ({
  __esModule: true,
  default: ({ currentPage, hidePreview }: { currentPage: NotionPage, hidePreview: () => void }) => (
    <div data-testid="notion-preview">
      <span data-testid="notion-preview-id">{currentPage.page_id}</span>
      <button data-testid="notion-preview-close" onClick={hidePreview}>Close</button>
    </div>
  ),
}))

// Mock PlanUpgradeModal (depends on useModalContext)
vi.mock('@/app/components/billing/plan-upgrade-modal', () => ({
  __esModule: true,
  default: ({ show, onClose }: { show: boolean, onClose: () => void }) => (
    show ? <div data-testid="plan-upgrade-modal"><button data-testid="plan-upgrade-close" onClick={onClose}>Close</button></div> : null
  ),
}))

// ==========================================
// Test Data Factories
// ==========================================

const createMockFile = (overrides: Partial<FileItem> = {}): FileItem => ({
  fileID: 'file-1',
  file: Object.assign(new File(['content'], 'test.txt', { type: 'text/plain' }), { id: 'uploaded-id-1' }),
  progress: 100,
  ...overrides,
})

const createMockNotionPage = (overrides: Partial<NotionPage> = {}): NotionPage => ({
  page_id: 'page-1',
  page_name: 'Test Page',
  parent_id: 'parent-1',
  type: 'page',
  is_bound: false,
  page_icon: null,
  workspace_id: 'workspace-1',
  ...overrides,
})

const createMockCrawlResultItem = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Website',
  markdown: '# Test Content',
  description: 'Test description',
  source_url: 'https://example.com',
  ...overrides,
})

const createMockCrawlOptions = (overrides: Partial<CrawlOptions> = {}): CrawlOptions => ({
  crawl_sub_pages: true,
  only_main_content: true,
  includes: '',
  excludes: '',
  limit: 10,
  max_depth: '',
  use_sitemap: true,
  ...overrides,
})

const createMockDataSourceAuth = (overrides: Partial<DataSourceAuth> = {}): DataSourceAuth => ({
  author: 'test-author',
  provider: 'notion_datasource',
  plugin_id: 'notion-plugin',
  plugin_unique_identifier: 'notion-plugin-unique',
  icon: 'notion-icon',
  name: 'Notion',
  label: { en_US: 'Notion', zh_Hans: 'Notion' },
  description: { en_US: 'Notion integration', zh_Hans: 'Notion集成' },
  credentials_list: [{
    id: 'cred-1',
    type: CredentialTypeEnum.API_KEY,
    name: 'Test Workspace',
    credential: { workspace_id: 'ws-1' },
    avatar_url: '',
    is_default: false,
  }],
  ...overrides,
})

const createDefaultProps = () => ({
  dataSourceType: DataSourceType.FILE,
  dataSourceTypeDisable: false,
  onSetting: vi.fn(),
  files: [] as FileItem[],
  updateFileList: vi.fn(),
  updateFile: vi.fn(),
  notionPages: [] as NotionPage[],
  notionCredentialId: '',
  updateNotionPages: vi.fn(),
  updateNotionCredentialId: vi.fn(),
  onStepChange: vi.fn(),
  changeType: vi.fn(),
  websitePages: [] as CrawlResultItem[],
  updateWebsitePages: vi.fn(),
  onWebsiteCrawlProviderChange: vi.fn(),
  onWebsiteCrawlJobIdChange: vi.fn(),
  crawlOptions: createMockCrawlOptions(),
  onCrawlOptionsChange: vi.fn(),
  authedDataSourceList: [] as DataSourceAuth[],
})

// ==========================================
// Tests
// ==========================================

describe('StepOne', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock states
    mockDatasetDetail = undefined
    mockPlanType = Plan.sandbox
    mockEnableBilling = false
    mockVectorSpaceUsage = 1
    mockVectorSpaceTotal = 10
    // Reset captured props
    fileSourceProps = {}
    notionSourceProps = {}
    webSourceProps = {}
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<StepOne {...props} />)

      // Assert - Real DataSourceSelector renders data source type options
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.file')).toBeInTheDocument()
    })

    it('should render step header when in create mode', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(screen.getByText('datasetCreation.steps.one')).toBeInTheDocument()
    })

    it('should render data source selector when creating new dataset', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<StepOne {...props} />)

      // Assert - Real DataSourceSelector renders data source type options
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.file')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.notion')).toBeInTheDocument()
    })

    it('should render empty dataset creation link when no datasetId', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation')).toBeInTheDocument()
    })

    it('should not render empty dataset creation link when datasetId exists', () => {
      // Arrange
      const props = { ...createDefaultProps(), datasetId: 'dataset-123' }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(screen.queryByText('datasetCreation.stepOne.emptyDatasetCreation')).not.toBeInTheDocument()
    })

    it('should not render data source selector when editing existing dataset with data_source_type', () => {
      // Arrange
      mockDatasetDetail = { data_source_type: DataSourceType.FILE }
      const props = { ...createDefaultProps(), datasetId: 'dataset-123' }

      // Act
      render(<StepOne {...props} />)

      // Assert - Data source type options should not be present
      expect(screen.queryByText('datasetCreation.stepOne.dataSourceType.file')).not.toBeInTheDocument()
      expect(screen.queryByText('datasetCreation.stepOne.dataSourceType.notion')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Data Source Type Rendering Tests
  // ==========================================
  describe('Data Source Type Rendering', () => {
    it('should render FileSource when dataSourceType is FILE', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.FILE }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(screen.getByTestId('file-source')).toBeInTheDocument()
      expect(screen.queryByTestId('notion-source')).not.toBeInTheDocument()
      expect(screen.queryByTestId('web-source')).not.toBeInTheDocument()
    })

    it('should render NotionSource when dataSourceType is NOTION', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.NOTION }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(screen.getByTestId('notion-source')).toBeInTheDocument()
      expect(screen.queryByTestId('file-source')).not.toBeInTheDocument()
      expect(screen.queryByTestId('web-source')).not.toBeInTheDocument()
    })

    it('should render WebSource when dataSourceType is WEB', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.WEB }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(screen.getByTestId('web-source')).toBeInTheDocument()
      expect(screen.queryByTestId('file-source')).not.toBeInTheDocument()
      expect(screen.queryByTestId('notion-source')).not.toBeInTheDocument()
    })

    it('should render nothing when dataSourceType is undefined', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: undefined }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(screen.queryByTestId('file-source')).not.toBeInTheDocument()
      expect(screen.queryByTestId('notion-source')).not.toBeInTheDocument()
      expect(screen.queryByTestId('web-source')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Passing Tests
  // ==========================================
  describe('Props Passing', () => {
    it('should pass correct props to FileSource', () => {
      // Arrange
      const mockFiles = [createMockFile()]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: mockFiles,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(fileSourceProps.files).toBe(mockFiles)
      expect(fileSourceProps.updateFileList).toBe(props.updateFileList)
      expect(fileSourceProps.updateFile).toBe(props.updateFile)
      expect(fileSourceProps.shouldShowDataSourceTypeList).toBe(true)
      expect(typeof fileSourceProps.onStepChange).toBe('function')
      expect(typeof fileSourceProps.onPreview).toBe('function')
    })

    it('should pass correct props to NotionSource', () => {
      // Arrange
      const mockNotionPages = [createMockNotionPage()]
      const mockAuth = createMockDataSourceAuth()
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
        notionPages: mockNotionPages,
        notionCredentialId: 'cred-123',
        authedDataSourceList: [mockAuth],
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(notionSourceProps.notionPages).toBe(mockNotionPages)
      expect(notionSourceProps.notionCredentialId).toBe('cred-123')
      expect(notionSourceProps.isNotionAuthed).toBe(true)
      expect(notionSourceProps.notionCredentialList).toEqual(mockAuth.credentials_list)
    })

    it('should pass correct props to WebSource', () => {
      // Arrange
      const mockWebsitePages = [createMockCrawlResultItem()]
      const mockCrawlOptions = createMockCrawlOptions({ limit: 20 })
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.WEB,
        websitePages: mockWebsitePages,
        crawlOptions: mockCrawlOptions,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(webSourceProps.websitePages).toBe(mockWebsitePages)
      expect(webSourceProps.crawlOptions).toBe(mockCrawlOptions)
      expect(webSourceProps.shouldShowDataSourceTypeList).toBe(true)
    })

    it('should render DataSourceSelector with correct active state', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        dataSourceTypeDisable: false,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert - DataSourceSelector is now a real component
      // It should render the file option with active styling
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.file')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.notion')).toBeInTheDocument()
    })
  })

  // ==========================================
  // State Management Tests
  // ==========================================
  describe('State Management', () => {
    it('should show empty dataset modal when clicking empty dataset creation link', () => {
      // Arrange
      const props = createDefaultProps()
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation'))

      // Assert
      expect(screen.getByTestId('empty-dataset-modal')).toBeInTheDocument()
    })

    it('should hide empty dataset modal when closing', () => {
      // Arrange
      const props = createDefaultProps()
      render(<StepOne {...props} />)
      fireEvent.click(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation'))

      // Act
      fireEvent.click(screen.getByText('Close'))

      // Assert
      expect(screen.queryByTestId('empty-dataset-modal')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Preview State Tests
  // ==========================================
  describe('Preview State', () => {
    it('should show file preview when file is selected', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.FILE }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('file-source-preview'))

      // Assert
      expect(screen.getByTestId('file-preview')).toBeInTheDocument()
      expect(screen.getByTestId('file-preview-name')).toHaveTextContent('test.txt')
    })

    it('should hide file preview when close button is clicked', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.FILE }
      render(<StepOne {...props} />)
      fireEvent.click(screen.getByTestId('file-source-preview'))

      // Act
      fireEvent.click(screen.getByTestId('file-preview-close'))

      // Assert
      expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
    })

    it('should show notion preview when notion page is selected', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.NOTION }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('notion-source-preview'))

      // Assert
      expect(screen.getByTestId('notion-preview')).toBeInTheDocument()
      expect(screen.getByTestId('notion-preview-id')).toHaveTextContent('page-1')
    })

    it('should hide notion preview when close button is clicked', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.NOTION }
      render(<StepOne {...props} />)
      fireEvent.click(screen.getByTestId('notion-source-preview'))

      // Act
      fireEvent.click(screen.getByTestId('notion-preview-close'))

      // Assert
      expect(screen.queryByTestId('notion-preview')).not.toBeInTheDocument()
    })

    it('should show website preview when website is selected', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.WEB }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('web-source-preview'))

      // Assert - Real WebsitePreview shows the page preview title and URL
      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
      expect(screen.getByText('https://test.com')).toBeInTheDocument()
    })

    it('should hide website preview when close button is clicked', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.WEB }
      render(<StepOne {...props} />)
      fireEvent.click(screen.getByTestId('web-source-preview'))

      // Act - Click on the close icon (XMarkIcon) in the real WebsitePreview
      const closeButton = screen.getByText('datasetCreation.stepOne.pagePreview').parentElement?.querySelector('svg')
      if (closeButton)
        fireEvent.click(closeButton.parentElement!)

      // Assert
      expect(screen.queryByText('https://test.com')).not.toBeInTheDocument()
    })

    it('should hide previews when switching data source type', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.FILE }
      render(<StepOne {...props} />)
      fireEvent.click(screen.getByTestId('file-source-preview'))
      expect(screen.getByTestId('file-preview')).toBeInTheDocument()

      // Act - Switch to Notion (click on the real DataSourceSelector component)
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      // Assert - File preview should be hidden (via the onHideFilePreview callback)
      expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Billing and Plan Upgrade Tests
  // ==========================================
  describe('Billing and Plan Upgrade', () => {
    it('should show plan upgrade modal when sandbox user tries to upload multiple files', () => {
      // Arrange
      mockPlanType = Plan.sandbox
      mockEnableBilling = true
      const mockFiles = [createMockFile({ fileID: 'file-1' }), createMockFile({ fileID: 'file-2' })]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: mockFiles,
      }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('file-source-next'))

      // Assert
      expect(screen.getByTestId('plan-upgrade-modal')).toBeInTheDocument()
      expect(props.onStepChange).not.toHaveBeenCalled()
    })

    it('should show plan upgrade modal when sandbox user tries to add multiple notion pages', () => {
      // Arrange
      mockPlanType = Plan.sandbox
      mockEnableBilling = true
      const mockNotionPages = [createMockNotionPage({ page_id: 'page-1' }), createMockNotionPage({ page_id: 'page-2' })]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
        notionPages: mockNotionPages,
      }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('notion-source-next'))

      // Assert
      expect(screen.getByTestId('plan-upgrade-modal')).toBeInTheDocument()
    })

    it('should show plan upgrade modal when sandbox user tries to add multiple website pages', () => {
      // Arrange
      mockPlanType = Plan.sandbox
      mockEnableBilling = true
      const mockWebsitePages = [createMockCrawlResultItem({ source_url: 'https://a.com' }), createMockCrawlResultItem({ source_url: 'https://b.com' })]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.WEB,
        websitePages: mockWebsitePages,
      }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('web-source-next'))

      // Assert
      expect(screen.getByTestId('plan-upgrade-modal')).toBeInTheDocument()
    })

    it('should proceed to next step when professional plan user uploads multiple files', () => {
      // Arrange
      mockPlanType = Plan.professional
      mockEnableBilling = true
      const mockFiles = [createMockFile({ fileID: 'file-1' }), createMockFile({ fileID: 'file-2' })]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: mockFiles,
      }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('file-source-next'))

      // Assert
      expect(screen.queryByTestId('plan-upgrade-modal')).not.toBeInTheDocument()
      expect(props.onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should proceed to next step when billing is disabled', () => {
      // Arrange
      mockPlanType = Plan.sandbox
      mockEnableBilling = false
      const mockFiles = [createMockFile({ fileID: 'file-1' }), createMockFile({ fileID: 'file-2' })]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: mockFiles,
      }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('file-source-next'))

      // Assert
      expect(screen.queryByTestId('plan-upgrade-modal')).not.toBeInTheDocument()
      expect(props.onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should proceed to next step with single file on sandbox plan', () => {
      // Arrange
      mockPlanType = Plan.sandbox
      mockEnableBilling = true
      const mockFiles = [createMockFile({ fileID: 'file-1' })]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: mockFiles,
      }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('file-source-next'))

      // Assert
      expect(screen.queryByTestId('plan-upgrade-modal')).not.toBeInTheDocument()
      expect(props.onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should close plan upgrade modal when close button is clicked', () => {
      // Arrange
      mockPlanType = Plan.sandbox
      mockEnableBilling = true
      const mockFiles = [createMockFile({ fileID: 'file-1' }), createMockFile({ fileID: 'file-2' })]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: mockFiles,
      }
      render(<StepOne {...props} />)
      fireEvent.click(screen.getByTestId('file-source-next'))

      // Act
      fireEvent.click(screen.getByTestId('plan-upgrade-close'))

      // Assert
      expect(screen.queryByTestId('plan-upgrade-modal')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Memoization Logic Tests
  // ==========================================
  describe('Memoization Logic', () => {
    it('should correctly compute isNotionAuthed when notion credentials exist', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
        authedDataSourceList: [createMockDataSourceAuth()],
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(notionSourceProps.isNotionAuthed).toBe(true)
    })

    it('should correctly compute isNotionAuthed as false when no notion credentials', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
        authedDataSourceList: [],
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(notionSourceProps.isNotionAuthed).toBe(false)
    })

    it('should correctly compute isNotionAuthed as false when credentials list is empty', () => {
      // Arrange
      const mockAuth = createMockDataSourceAuth({ credentials_list: [] })
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
        authedDataSourceList: [mockAuth],
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(notionSourceProps.isNotionAuthed).toBe(false)
    })

    it('should correctly compute notionCredentialList', () => {
      // Arrange
      const mockAuth = createMockDataSourceAuth()
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
        authedDataSourceList: [mockAuth],
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(notionSourceProps.notionCredentialList).toEqual(mockAuth.credentials_list)
    })

    it('should compute isShowVectorSpaceFull correctly when vector space is full', () => {
      // Arrange
      mockEnableBilling = true
      mockVectorSpaceUsage = 10
      mockVectorSpaceTotal = 10
      const mockFiles = [createMockFile()]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: mockFiles,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(fileSourceProps.isShowVectorSpaceFull).toBe(true)
    })

    it('should compute isShowVectorSpaceFull as false when billing is disabled', () => {
      // Arrange
      mockEnableBilling = false
      mockVectorSpaceUsage = 10
      mockVectorSpaceTotal = 10
      const mockFiles = [createMockFile()]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: mockFiles,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(fileSourceProps.isShowVectorSpaceFull).toBe(false)
    })

    it('should compute isShowVectorSpaceFull as false when no files loaded', () => {
      // Arrange
      mockEnableBilling = true
      mockVectorSpaceUsage = 10
      mockVectorSpaceTotal = 10
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: [],
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(fileSourceProps.isShowVectorSpaceFull).toBe(false)
    })

    it('should compute supportBatchUpload correctly for sandbox plan', () => {
      // Arrange
      mockPlanType = Plan.sandbox
      mockEnableBilling = true
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(fileSourceProps.supportBatchUpload).toBe(false)
    })

    it('should compute supportBatchUpload correctly for professional plan', () => {
      // Arrange
      mockPlanType = Plan.professional
      mockEnableBilling = true
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(fileSourceProps.supportBatchUpload).toBe(true)
    })
  })

  // ==========================================
  // Callback Stability Tests
  // ==========================================
  describe('Callback Stability', () => {
    it('should call changeType when data source type changes', () => {
      // Arrange
      const props = createDefaultProps()
      render(<StepOne {...props} />)

      // Act - Click on Notion option in real DataSourceSelector
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      // Assert
      expect(props.changeType).toHaveBeenCalledWith(DataSourceType.NOTION)
    })

    it('should call onStepChange when proceeding to next step', () => {
      // Arrange
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.FILE }
      render(<StepOne {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('file-source-next'))

      // Assert
      expect(props.onStepChange).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================
  // Edge Cases Tests
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle empty authedDataSourceList', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
        authedDataSourceList: [],
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(notionSourceProps.isNotionAuthed).toBe(false)
      expect(notionSourceProps.notionCredentialList).toEqual([])
    })

    it('should handle undefined notionPages with default empty array', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
        notionPages: undefined,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(notionSourceProps.notionPages).toEqual([])
    })

    it('should handle undefined websitePages with default empty array', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.WEB,
        websitePages: undefined,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(webSourceProps.websitePages).toEqual([])
    })

    it('should handle files without uploaded id (not all files loaded)', () => {
      // Arrange
      mockEnableBilling = true
      mockVectorSpaceUsage = 10
      mockVectorSpaceTotal = 10
      const mockFiles = [
        { fileID: 'file-1', file: new File([''], 'test.txt') as FileItem['file'], progress: 50 },
      ]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        files: mockFiles,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert - isShowVectorSpaceFull should be false because not all files are loaded
      expect(fileSourceProps.isShowVectorSpaceFull).toBe(false)
    })

    it('should use dataset data_source_type when editing existing dataset', () => {
      // Arrange
      mockDatasetDetail = { data_source_type: DataSourceType.NOTION }
      const props = {
        ...createDefaultProps(),
        datasetId: 'dataset-123',
        dataSourceType: DataSourceType.FILE, // This should be overridden
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(screen.getByTestId('notion-source')).toBeInTheDocument()
      expect(screen.queryByTestId('file-source')).not.toBeInTheDocument()
    })

    it('should show data source selector when editing dataset without data_source_type', () => {
      // Arrange
      mockDatasetDetail = { data_source_type: undefined }
      const props = {
        ...createDefaultProps(),
        datasetId: 'dataset-123',
      }

      // Act
      render(<StepOne {...props} />)

      // Assert - Real DataSourceSelector renders data source type options
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.file')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.notion')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Event Handler Tests
  // ==========================================
  describe('Event Handlers', () => {
    it('should handle data source type change correctly', () => {
      // Arrange
      const props = createDefaultProps()
      render(<StepOne {...props} />)

      // Act - Click on Web option in real DataSourceSelector
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.web'))

      // Assert
      expect(props.changeType).toHaveBeenCalledWith(DataSourceType.WEB)
    })

    it('should pass correct onSetting callback to NotionSource', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(notionSourceProps.onSetting).toBe(props.onSetting)
    })

    it('should pass callback handlers to WebSource', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.WEB,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(webSourceProps.updateWebsitePages).toBe(props.updateWebsitePages)
      expect(webSourceProps.onWebsiteCrawlProviderChange).toBe(props.onWebsiteCrawlProviderChange)
      expect(webSourceProps.onWebsiteCrawlJobIdChange).toBe(props.onWebsiteCrawlJobIdChange)
      expect(webSourceProps.onCrawlOptionsChange).toBe(props.onCrawlOptionsChange)
    })
  })

  // ==========================================
  // Prop Variations Tests
  // ==========================================
  describe('Prop Variations', () => {
    it('should pass isSandboxPlan correctly to FileSource', () => {
      // Arrange
      mockPlanType = Plan.sandbox
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.FILE }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(fileSourceProps.isSandboxPlan).toBe(true)
    })

    it('should pass enableBilling correctly to FileSource', () => {
      // Arrange
      mockEnableBilling = true
      const props = { ...createDefaultProps(), dataSourceType: DataSourceType.FILE }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(fileSourceProps.enableBilling).toBe(true)
    })

    it('should pass datasetId to NotionSource', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.NOTION,
        datasetId: 'dataset-abc',
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(notionSourceProps.datasetId).toBe('dataset-abc')
    })

    it('should pass authedDataSourceList to WebSource', () => {
      // Arrange
      const mockAuthedList = [createMockDataSourceAuth()]
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.WEB,
        authedDataSourceList: mockAuthedList,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert
      expect(webSourceProps.authedDataSourceList).toBe(mockAuthedList)
    })

    it('should correctly disable data source selector via dataSourceTypeDisable prop', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        dataSourceType: DataSourceType.FILE,
        dataSourceTypeDisable: true,
      }

      // Act
      render(<StepOne {...props} />)

      // Assert - When disabled, clicking should not change type
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))
      expect(props.changeType).not.toHaveBeenCalled()
    })
  })
})
