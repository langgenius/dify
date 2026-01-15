import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { NotionPage } from '@/models/common'
import type { CrawlOptions, CrawlResultItem, DataSet, FileItem } from '@/models/datasets'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { DataSourceType } from '@/models/datasets'
import { DataSourceTypeSelector, NextStepButton, PreviewPanel } from './components'
import { usePreviewState } from './hooks'
import StepOne from './index'

// ==========================================
// Mock External Dependencies
// ==========================================

// Mock config for website crawl features
vi.mock('@/config', () => ({
  ENABLE_WEBSITE_FIRECRAWL: true,
  ENABLE_WEBSITE_JINAREADER: false,
  ENABLE_WEBSITE_WATERCRAWL: false,
}))

// Mock dataset detail context
let mockDatasetDetail: DataSet | undefined
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: DataSet | undefined }) => DataSet | undefined) => {
    return selector({ dataset: mockDatasetDetail })
  },
}))

// Mock provider context
let mockPlan = {
  type: Plan.professional,
  usage: { vectorSpace: 50, buildApps: 0, documentsUploadQuota: 0, vectorStorageQuota: 0 },
  total: { vectorSpace: 100, buildApps: 0, documentsUploadQuota: 0, vectorStorageQuota: 0 },
}
let mockEnableBilling = false

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: mockPlan,
    enableBilling: mockEnableBilling,
  }),
}))

// Mock child components
vi.mock('../file-uploader', () => ({
  default: ({ onPreview, fileList }: { onPreview: (file: File) => void, fileList: FileItem[] }) => (
    <div data-testid="file-uploader">
      <span data-testid="file-count">{fileList.length}</span>
      <button data-testid="preview-file" onClick={() => onPreview(new File(['test'], 'test.txt'))}>
        Preview
      </button>
    </div>
  ),
}))

vi.mock('../website', () => ({
  default: ({ onPreview }: { onPreview: (item: CrawlResultItem) => void }) => (
    <div data-testid="website">
      <button
        data-testid="preview-website"
        onClick={() => onPreview({ title: 'Test', markdown: '', description: '', source_url: 'https://test.com' })}
      >
        Preview Website
      </button>
    </div>
  ),
}))

vi.mock('../empty-dataset-creation-modal', () => ({
  default: ({ show, onHide }: { show: boolean, onHide: () => void }) => (
    show
      ? (
          <div data-testid="empty-dataset-modal">
            <button data-testid="close-modal" onClick={onHide}>Close</button>
          </div>
        )
      : null
  ),
}))

// NotionConnector is a base component - imported directly without mock
// It only depends on i18n which is globally mocked

vi.mock('@/app/components/base/notion-page-selector', () => ({
  NotionPageSelector: ({ onPreview }: { onPreview: (page: NotionPage) => void }) => (
    <div data-testid="notion-page-selector">
      <button
        data-testid="preview-notion"
        onClick={() => onPreview({ page_id: 'page-1', type: 'page' } as NotionPage)}
      >
        Preview Notion
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/billing/vector-space-full', () => ({
  default: () => <div data-testid="vector-space-full">Vector Space Full</div>,
}))

vi.mock('@/app/components/billing/plan-upgrade-modal', () => ({
  default: ({ show, onClose }: { show: boolean, onClose: () => void }) => (
    show
      ? (
          <div data-testid="plan-upgrade-modal">
            <button data-testid="close-upgrade-modal" onClick={onClose}>Close</button>
          </div>
        )
      : null
  ),
}))

vi.mock('../file-preview', () => ({
  default: ({ file, hidePreview }: { file: File, hidePreview: () => void }) => (
    <div data-testid="file-preview">
      <span>{file.name}</span>
      <button data-testid="hide-file-preview" onClick={hidePreview}>Hide</button>
    </div>
  ),
}))

vi.mock('../notion-page-preview', () => ({
  default: ({ currentPage, hidePreview }: { currentPage: NotionPage, hidePreview: () => void }) => (
    <div data-testid="notion-page-preview">
      <span>{currentPage.page_id}</span>
      <button data-testid="hide-notion-preview" onClick={hidePreview}>Hide</button>
    </div>
  ),
}))

// WebsitePreview is a sibling component without API dependencies - imported directly
// It only depends on i18n which is globally mocked

vi.mock('./upgrade-card', () => ({
  default: () => <div data-testid="upgrade-card">Upgrade Card</div>,
}))

// ==========================================
// Test Data Builders
// ==========================================

const createMockCustomFile = (overrides: { id?: string, name?: string } = {}) => {
  const file = new File(['test content'], overrides.name ?? 'test.txt', { type: 'text/plain' })
  return Object.assign(file, {
    id: overrides.id ?? 'uploaded-id',
    extension: 'txt',
    mime_type: 'text/plain',
    created_by: 'user-1',
    created_at: Date.now(),
  })
}

const createMockFileItem = (overrides: Partial<FileItem> = {}): FileItem => ({
  fileID: `file-${Date.now()}`,
  file: createMockCustomFile(overrides.file as { id?: string, name?: string }),
  progress: 100,
  ...overrides,
})

const createMockNotionPage = (overrides: Partial<NotionPage> = {}): NotionPage => ({
  page_id: `page-${Date.now()}`,
  type: 'page',
  ...overrides,
} as NotionPage)

const createMockCrawlResult = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Page',
  markdown: 'Test content',
  description: 'Test description',
  source_url: 'https://example.com',
  ...overrides,
})

const createMockDataSourceAuth = (overrides: Partial<DataSourceAuth> = {}): DataSourceAuth => ({
  credential_id: 'cred-1',
  provider: 'notion_datasource',
  plugin_id: 'plugin-1',
  credentials_list: [{ id: 'cred-1', name: 'Workspace 1' }],
  ...overrides,
} as DataSourceAuth)

const defaultProps = {
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
  crawlOptions: {
    crawl_sub_pages: true,
    only_main_content: true,
    includes: '',
    excludes: '',
    limit: 10,
    max_depth: '',
    use_sitemap: true,
  } as CrawlOptions,
  onCrawlOptionsChange: vi.fn(),
  authedDataSourceList: [] as DataSourceAuth[],
}

// ==========================================
// usePreviewState Hook Tests
// ==========================================
describe('usePreviewState Hook', () => {
  // --------------------------------------------------------------------------
  // Initial State Tests
  // --------------------------------------------------------------------------
  describe('Initial State', () => {
    it('should initialize with all preview states undefined', () => {
      // Arrange & Act
      const { result } = renderHook(() => usePreviewState())

      // Assert
      expect(result.current.currentFile).toBeUndefined()
      expect(result.current.currentNotionPage).toBeUndefined()
      expect(result.current.currentWebsite).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // File Preview Tests
  // --------------------------------------------------------------------------
  describe('File Preview', () => {
    it('should show file preview when showFilePreview is called', () => {
      // Arrange
      const { result } = renderHook(() => usePreviewState())
      const mockFile = new File(['test'], 'test.txt')

      // Act
      act(() => {
        result.current.showFilePreview(mockFile)
      })

      // Assert
      expect(result.current.currentFile).toBe(mockFile)
    })

    it('should hide file preview when hideFilePreview is called', () => {
      // Arrange
      const { result } = renderHook(() => usePreviewState())
      const mockFile = new File(['test'], 'test.txt')

      act(() => {
        result.current.showFilePreview(mockFile)
      })

      // Act
      act(() => {
        result.current.hideFilePreview()
      })

      // Assert
      expect(result.current.currentFile).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // Notion Page Preview Tests
  // --------------------------------------------------------------------------
  describe('Notion Page Preview', () => {
    it('should show notion page preview when showNotionPagePreview is called', () => {
      // Arrange
      const { result } = renderHook(() => usePreviewState())
      const mockPage = createMockNotionPage()

      // Act
      act(() => {
        result.current.showNotionPagePreview(mockPage)
      })

      // Assert
      expect(result.current.currentNotionPage).toBe(mockPage)
    })

    it('should hide notion page preview when hideNotionPagePreview is called', () => {
      // Arrange
      const { result } = renderHook(() => usePreviewState())
      const mockPage = createMockNotionPage()

      act(() => {
        result.current.showNotionPagePreview(mockPage)
      })

      // Act
      act(() => {
        result.current.hideNotionPagePreview()
      })

      // Assert
      expect(result.current.currentNotionPage).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // Website Preview Tests
  // --------------------------------------------------------------------------
  describe('Website Preview', () => {
    it('should show website preview when showWebsitePreview is called', () => {
      // Arrange
      const { result } = renderHook(() => usePreviewState())
      const mockWebsite = createMockCrawlResult()

      // Act
      act(() => {
        result.current.showWebsitePreview(mockWebsite)
      })

      // Assert
      expect(result.current.currentWebsite).toBe(mockWebsite)
    })

    it('should hide website preview when hideWebsitePreview is called', () => {
      // Arrange
      const { result } = renderHook(() => usePreviewState())
      const mockWebsite = createMockCrawlResult()

      act(() => {
        result.current.showWebsitePreview(mockWebsite)
      })

      // Act
      act(() => {
        result.current.hideWebsitePreview()
      })

      // Assert
      expect(result.current.currentWebsite).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // Callback Stability Tests (Memoization)
  // --------------------------------------------------------------------------
  describe('Callback Stability', () => {
    it('should maintain stable showFilePreview callback reference', () => {
      // Arrange
      const { result, rerender } = renderHook(() => usePreviewState())
      const initialCallback = result.current.showFilePreview

      // Act
      rerender()

      // Assert
      expect(result.current.showFilePreview).toBe(initialCallback)
    })

    it('should maintain stable hideFilePreview callback reference', () => {
      // Arrange
      const { result, rerender } = renderHook(() => usePreviewState())
      const initialCallback = result.current.hideFilePreview

      // Act
      rerender()

      // Assert
      expect(result.current.hideFilePreview).toBe(initialCallback)
    })

    it('should maintain stable showNotionPagePreview callback reference', () => {
      // Arrange
      const { result, rerender } = renderHook(() => usePreviewState())
      const initialCallback = result.current.showNotionPagePreview

      // Act
      rerender()

      // Assert
      expect(result.current.showNotionPagePreview).toBe(initialCallback)
    })

    it('should maintain stable hideNotionPagePreview callback reference', () => {
      // Arrange
      const { result, rerender } = renderHook(() => usePreviewState())
      const initialCallback = result.current.hideNotionPagePreview

      // Act
      rerender()

      // Assert
      expect(result.current.hideNotionPagePreview).toBe(initialCallback)
    })

    it('should maintain stable showWebsitePreview callback reference', () => {
      // Arrange
      const { result, rerender } = renderHook(() => usePreviewState())
      const initialCallback = result.current.showWebsitePreview

      // Act
      rerender()

      // Assert
      expect(result.current.showWebsitePreview).toBe(initialCallback)
    })

    it('should maintain stable hideWebsitePreview callback reference', () => {
      // Arrange
      const { result, rerender } = renderHook(() => usePreviewState())
      const initialCallback = result.current.hideWebsitePreview

      // Act
      rerender()

      // Assert
      expect(result.current.hideWebsitePreview).toBe(initialCallback)
    })
  })
})

// ==========================================
// DataSourceTypeSelector Component Tests
// ==========================================
describe('DataSourceTypeSelector', () => {
  const defaultSelectorProps = {
    currentType: DataSourceType.FILE,
    disabled: false,
    onChange: vi.fn(),
    onClearPreviews: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render all data source options when web is enabled', () => {
      // Arrange & Act
      render(<DataSourceTypeSelector {...defaultSelectorProps} />)

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.file')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.notion')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.web')).toBeInTheDocument()
    })

    it('should highlight active type', () => {
      // Arrange & Act
      const { container } = render(
        <DataSourceTypeSelector {...defaultSelectorProps} currentType={DataSourceType.NOTION} />,
      )

      // Assert - The active item should have the active class
      const items = container.querySelectorAll('[class*="dataSourceItem"]')
      expect(items.length).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onChange when a type is clicked', () => {
      // Arrange
      const onChange = vi.fn()
      render(<DataSourceTypeSelector {...defaultSelectorProps} onChange={onChange} />)

      // Act
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      // Assert
      expect(onChange).toHaveBeenCalledWith(DataSourceType.NOTION)
    })

    it('should call onClearPreviews when a type is clicked', () => {
      // Arrange
      const onClearPreviews = vi.fn()
      render(<DataSourceTypeSelector {...defaultSelectorProps} onClearPreviews={onClearPreviews} />)

      // Act
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.web'))

      // Assert
      expect(onClearPreviews).toHaveBeenCalledWith(DataSourceType.WEB)
    })

    it('should not call onChange when disabled', () => {
      // Arrange
      const onChange = vi.fn()
      render(<DataSourceTypeSelector {...defaultSelectorProps} disabled onChange={onChange} />)

      // Act
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      // Assert
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should not call onClearPreviews when disabled', () => {
      // Arrange
      const onClearPreviews = vi.fn()
      render(<DataSourceTypeSelector {...defaultSelectorProps} disabled onClearPreviews={onClearPreviews} />)

      // Act
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      // Assert
      expect(onClearPreviews).not.toHaveBeenCalled()
    })
  })
})

// ==========================================
// NextStepButton Component Tests
// ==========================================
describe('NextStepButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render with correct label', () => {
      // Arrange & Act
      render(<NextStepButton disabled={false} onClick={vi.fn()} />)

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.button')).toBeInTheDocument()
    })

    it('should render with arrow icon', () => {
      // Arrange & Act
      const { container } = render(<NextStepButton disabled={false} onClick={vi.fn()} />)

      // Assert
      const svgIcon = container.querySelector('svg')
      expect(svgIcon).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should be disabled when disabled prop is true', () => {
      // Arrange & Act
      render(<NextStepButton disabled onClick={vi.fn()} />)

      // Assert
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should be enabled when disabled prop is false', () => {
      // Arrange & Act
      render(<NextStepButton disabled={false} onClick={vi.fn()} />)

      // Assert
      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should call onClick when clicked and not disabled', () => {
      // Arrange
      const onClick = vi.fn()
      render(<NextStepButton disabled={false} onClick={onClick} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should not call onClick when clicked and disabled', () => {
      // Arrange
      const onClick = vi.fn()
      render(<NextStepButton disabled onClick={onClick} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(onClick).not.toHaveBeenCalled()
    })
  })
})

// ==========================================
// PreviewPanel Component Tests
// ==========================================
describe('PreviewPanel', () => {
  const defaultPreviewProps = {
    currentFile: undefined as File | undefined,
    currentNotionPage: undefined as NotionPage | undefined,
    currentWebsite: undefined as CrawlResultItem | undefined,
    notionCredentialId: 'cred-1',
    isShowPlanUpgradeModal: false,
    hideFilePreview: vi.fn(),
    hideNotionPagePreview: vi.fn(),
    hideWebsitePreview: vi.fn(),
    hidePlanUpgradeModal: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Conditional Rendering Tests
  // --------------------------------------------------------------------------
  describe('Conditional Rendering', () => {
    it('should not render FilePreview when currentFile is undefined', () => {
      // Arrange & Act
      render(<PreviewPanel {...defaultPreviewProps} />)

      // Assert
      expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
    })

    it('should render FilePreview when currentFile is defined', () => {
      // Arrange
      const file = new File(['test'], 'test.txt')

      // Act
      render(<PreviewPanel {...defaultPreviewProps} currentFile={file} />)

      // Assert
      expect(screen.getByTestId('file-preview')).toBeInTheDocument()
    })

    it('should not render NotionPagePreview when currentNotionPage is undefined', () => {
      // Arrange & Act
      render(<PreviewPanel {...defaultPreviewProps} />)

      // Assert
      expect(screen.queryByTestId('notion-page-preview')).not.toBeInTheDocument()
    })

    it('should render NotionPagePreview when currentNotionPage is defined', () => {
      // Arrange
      const page = createMockNotionPage()

      // Act
      render(<PreviewPanel {...defaultPreviewProps} currentNotionPage={page} />)

      // Assert
      expect(screen.getByTestId('notion-page-preview')).toBeInTheDocument()
    })

    it('should not render WebsitePreview when currentWebsite is undefined', () => {
      // Arrange & Act
      render(<PreviewPanel {...defaultPreviewProps} />)

      // Assert - pagePreview is the title shown in WebsitePreview
      expect(screen.queryByText('datasetCreation.stepOne.pagePreview')).not.toBeInTheDocument()
    })

    it('should render WebsitePreview when currentWebsite is defined', () => {
      // Arrange
      const website = createMockCrawlResult()

      // Act
      render(<PreviewPanel {...defaultPreviewProps} currentWebsite={website} />)

      // Assert - Check for the preview title and source URL
      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
      expect(screen.getByText(website.source_url)).toBeInTheDocument()
    })

    it('should not render PlanUpgradeModal when isShowPlanUpgradeModal is false', () => {
      // Arrange & Act
      render(<PreviewPanel {...defaultPreviewProps} isShowPlanUpgradeModal={false} />)

      // Assert
      expect(screen.queryByTestId('plan-upgrade-modal')).not.toBeInTheDocument()
    })

    it('should render PlanUpgradeModal when isShowPlanUpgradeModal is true', () => {
      // Arrange & Act
      render(<PreviewPanel {...defaultPreviewProps} isShowPlanUpgradeModal />)

      // Assert
      expect(screen.getByTestId('plan-upgrade-modal')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Event Handler Tests
  // --------------------------------------------------------------------------
  describe('Event Handlers', () => {
    it('should call hideFilePreview when file preview close is clicked', () => {
      // Arrange
      const hideFilePreview = vi.fn()
      const file = new File(['test'], 'test.txt')
      render(<PreviewPanel {...defaultPreviewProps} currentFile={file} hideFilePreview={hideFilePreview} />)

      // Act
      fireEvent.click(screen.getByTestId('hide-file-preview'))

      // Assert
      expect(hideFilePreview).toHaveBeenCalledTimes(1)
    })

    it('should call hideNotionPagePreview when notion preview close is clicked', () => {
      // Arrange
      const hideNotionPagePreview = vi.fn()
      const page = createMockNotionPage()
      render(<PreviewPanel {...defaultPreviewProps} currentNotionPage={page} hideNotionPagePreview={hideNotionPagePreview} />)

      // Act
      fireEvent.click(screen.getByTestId('hide-notion-preview'))

      // Assert
      expect(hideNotionPagePreview).toHaveBeenCalledTimes(1)
    })

    it('should call hideWebsitePreview when website preview close is clicked', () => {
      // Arrange
      const hideWebsitePreview = vi.fn()
      const website = createMockCrawlResult()
      const { container } = render(<PreviewPanel {...defaultPreviewProps} currentWebsite={website} hideWebsitePreview={hideWebsitePreview} />)

      // Act - Find the close button (div with cursor-pointer class containing the XMarkIcon)
      const closeButton = container.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument()
      fireEvent.click(closeButton!)

      // Assert
      expect(hideWebsitePreview).toHaveBeenCalledTimes(1)
    })

    it('should call hidePlanUpgradeModal when modal close is clicked', () => {
      // Arrange
      const hidePlanUpgradeModal = vi.fn()
      render(<PreviewPanel {...defaultPreviewProps} isShowPlanUpgradeModal hidePlanUpgradeModal={hidePlanUpgradeModal} />)

      // Act
      fireEvent.click(screen.getByTestId('close-upgrade-modal'))

      // Assert
      expect(hidePlanUpgradeModal).toHaveBeenCalledTimes(1)
    })
  })
})

// ==========================================
// StepOne Component Tests
// ==========================================
describe('StepOne', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetDetail = undefined
    mockPlan = {
      type: Plan.professional,
      usage: { vectorSpace: 50, buildApps: 0, documentsUploadQuota: 0, vectorStorageQuota: 0 },
      total: { vectorSpace: 100, buildApps: 0, documentsUploadQuota: 0, vectorStorageQuota: 0 },
    }
    mockEnableBilling = false
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} />)

      // Assert
      expect(screen.getByText('datasetCreation.steps.one')).toBeInTheDocument()
    })

    it('should render DataSourceTypeSelector when not editing existing dataset', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} />)

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.file')).toBeInTheDocument()
    })

    it('should render FileUploader when dataSourceType is FILE', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.FILE} />)

      // Assert
      expect(screen.getByTestId('file-uploader')).toBeInTheDocument()
    })

    it('should render NotionConnector when dataSourceType is NOTION and not authenticated', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} />)

      // Assert - NotionConnector shows sync title and connect button
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.connect/i })).toBeInTheDocument()
    })

    it('should render NotionPageSelector when dataSourceType is NOTION and authenticated', () => {
      // Arrange
      const authedDataSourceList = [createMockDataSourceAuth()]

      // Act
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={authedDataSourceList} />)

      // Assert
      expect(screen.getByTestId('notion-page-selector')).toBeInTheDocument()
    })

    it('should render Website when dataSourceType is WEB', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.WEB} />)

      // Assert
      expect(screen.getByTestId('website')).toBeInTheDocument()
    })

    it('should render empty dataset creation link when no datasetId', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} />)

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation')).toBeInTheDocument()
    })

    it('should not render empty dataset creation link when datasetId exists', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} datasetId="dataset-123" />)

      // Assert
      expect(screen.queryByText('datasetCreation.stepOne.emptyDatasetCreation')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should pass files to FileUploader', () => {
      // Arrange
      const files = [createMockFileItem()]

      // Act
      render(<StepOne {...defaultProps} files={files} />)

      // Assert
      expect(screen.getByTestId('file-count')).toHaveTextContent('1')
    })

    it('should call onSetting when NotionConnector connect button is clicked', () => {
      // Arrange
      const onSetting = vi.fn()
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} onSetting={onSetting} />)

      // Act - The NotionConnector's button calls onSetting
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.connect/i }))

      // Assert
      expect(onSetting).toHaveBeenCalledTimes(1)
    })

    it('should call changeType when data source type is changed', () => {
      // Arrange
      const changeType = vi.fn()
      render(<StepOne {...defaultProps} changeType={changeType} />)

      // Act
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      // Assert
      expect(changeType).toHaveBeenCalledWith(DataSourceType.NOTION)
    })
  })

  // --------------------------------------------------------------------------
  // State Management Tests
  // --------------------------------------------------------------------------
  describe('State Management', () => {
    it('should open empty dataset modal when link is clicked', () => {
      // Arrange
      render(<StepOne {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation'))

      // Assert
      expect(screen.getByTestId('empty-dataset-modal')).toBeInTheDocument()
    })

    it('should close empty dataset modal when close is clicked', () => {
      // Arrange
      render(<StepOne {...defaultProps} />)
      fireEvent.click(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation'))

      // Act
      fireEvent.click(screen.getByTestId('close-modal'))

      // Assert
      expect(screen.queryByTestId('empty-dataset-modal')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should correctly compute isNotionAuthed based on authedDataSourceList', () => {
      // Arrange - No auth
      const { rerender } = render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} />)
      // NotionConnector shows the sync title when not authenticated
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()

      // Act - Add auth
      const authedDataSourceList = [createMockDataSourceAuth()]
      rerender(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={authedDataSourceList} />)

      // Assert
      expect(screen.getByTestId('notion-page-selector')).toBeInTheDocument()
    })

    it('should correctly compute fileNextDisabled when files are empty', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} files={[]} />)

      // Assert - Button should be disabled
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should correctly compute fileNextDisabled when files are loaded', () => {
      // Arrange
      const files = [createMockFileItem()]

      // Act
      render(<StepOne {...defaultProps} files={files} />)

      // Assert - Button should be enabled
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })

    it('should correctly compute fileNextDisabled when some files are not uploaded', () => {
      // Arrange - Create a file item without id (not yet uploaded)
      const file = new File(['test'], 'test.txt', { type: 'text/plain' })
      const fileItem: FileItem = {
        fileID: 'temp-id',
        file: Object.assign(file, { id: undefined, extension: 'txt', mime_type: 'text/plain' }),
        progress: 0,
      }

      // Act
      render(<StepOne {...defaultProps} files={[fileItem]} />)

      // Assert - Button should be disabled
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })
  })

  // --------------------------------------------------------------------------
  // Callback Tests
  // --------------------------------------------------------------------------
  describe('Callbacks', () => {
    it('should call onStepChange when next button is clicked with valid files', () => {
      // Arrange
      const onStepChange = vi.fn()
      const files = [createMockFileItem()]
      render(<StepOne {...defaultProps} files={files} onStepChange={onStepChange} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      // Assert
      expect(onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should show plan upgrade modal when batch upload not supported and multiple files', () => {
      // Arrange
      mockEnableBilling = true
      mockPlan.type = Plan.sandbox
      const files = [createMockFileItem(), createMockFileItem()]
      render(<StepOne {...defaultProps} files={files} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      // Assert
      expect(screen.getByTestId('plan-upgrade-modal')).toBeInTheDocument()
    })

    it('should show upgrade card when in sandbox plan with files', () => {
      // Arrange
      mockEnableBilling = true
      mockPlan.type = Plan.sandbox
      const files = [createMockFileItem()]

      // Act
      render(<StepOne {...defaultProps} files={files} />)

      // Assert
      expect(screen.getByTestId('upgrade-card')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Vector Space Full Tests
  // --------------------------------------------------------------------------
  describe('Vector Space Full', () => {
    it('should show VectorSpaceFull when vector space is full and billing is enabled', () => {
      // Arrange
      mockEnableBilling = true
      mockPlan.usage.vectorSpace = 100
      mockPlan.total.vectorSpace = 100
      const files = [createMockFileItem()]

      // Act
      render(<StepOne {...defaultProps} files={files} />)

      // Assert
      expect(screen.getByTestId('vector-space-full')).toBeInTheDocument()
    })

    it('should disable next button when vector space is full', () => {
      // Arrange
      mockEnableBilling = true
      mockPlan.usage.vectorSpace = 100
      mockPlan.total.vectorSpace = 100
      const files = [createMockFileItem()]

      // Act
      render(<StepOne {...defaultProps} files={files} />)

      // Assert
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })
  })

  // --------------------------------------------------------------------------
  // Preview Integration Tests
  // --------------------------------------------------------------------------
  describe('Preview Integration', () => {
    it('should show file preview when file preview button is clicked', () => {
      // Arrange
      render(<StepOne {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByTestId('preview-file'))

      // Assert
      expect(screen.getByTestId('file-preview')).toBeInTheDocument()
    })

    it('should hide file preview when hide button is clicked', () => {
      // Arrange
      render(<StepOne {...defaultProps} />)
      fireEvent.click(screen.getByTestId('preview-file'))

      // Act
      fireEvent.click(screen.getByTestId('hide-file-preview'))

      // Assert
      expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
    })

    it('should show notion page preview when preview button is clicked', () => {
      // Arrange
      const authedDataSourceList = [createMockDataSourceAuth()]
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={authedDataSourceList} />)

      // Act
      fireEvent.click(screen.getByTestId('preview-notion'))

      // Assert
      expect(screen.getByTestId('notion-page-preview')).toBeInTheDocument()
    })

    it('should show website preview when preview button is clicked', () => {
      // Arrange
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.WEB} />)

      // Act
      fireEvent.click(screen.getByTestId('preview-website'))

      // Assert - Check for pagePreview title which is shown by WebsitePreview
      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty notionPages array', () => {
      // Arrange
      const authedDataSourceList = [createMockDataSourceAuth()]

      // Act
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} notionPages={[]} authedDataSourceList={authedDataSourceList} />)

      // Assert - Button should be disabled when no pages selected
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should handle empty websitePages array', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.WEB} websitePages={[]} />)

      // Assert - Button should be disabled when no pages crawled
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should handle empty authedDataSourceList', () => {
      // Arrange & Act
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={[]} />)

      // Assert - Should show NotionConnector with connect button
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()
    })

    it('should handle authedDataSourceList without notion credentials', () => {
      // Arrange
      const authedDataSourceList = [createMockDataSourceAuth({ credentials_list: [] })]

      // Act
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={authedDataSourceList} />)

      // Assert - Should show NotionConnector with connect button
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()
    })

    it('should clear previews when switching data source types', () => {
      // Arrange
      render(<StepOne {...defaultProps} />)
      fireEvent.click(screen.getByTestId('preview-file'))
      expect(screen.getByTestId('file-preview')).toBeInTheDocument()

      // Act - Change to NOTION
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      // Assert - File preview should be cleared
      expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Integration Tests
  // --------------------------------------------------------------------------
  describe('Integration', () => {
    it('should complete file upload flow', () => {
      // Arrange
      const onStepChange = vi.fn()
      const files = [createMockFileItem()]

      // Act
      render(<StepOne {...defaultProps} files={files} onStepChange={onStepChange} />)
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      // Assert
      expect(onStepChange).toHaveBeenCalled()
    })

    it('should complete notion page selection flow', () => {
      // Arrange
      const onStepChange = vi.fn()
      const authedDataSourceList = [createMockDataSourceAuth()]
      const notionPages = [createMockNotionPage()]

      // Act
      render(
        <StepOne
          {...defaultProps}
          dataSourceType={DataSourceType.NOTION}
          authedDataSourceList={authedDataSourceList}
          notionPages={notionPages}
          onStepChange={onStepChange}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      // Assert
      expect(onStepChange).toHaveBeenCalled()
    })

    it('should complete website crawl flow', () => {
      // Arrange
      const onStepChange = vi.fn()
      const websitePages = [createMockCrawlResult()]

      // Act
      render(
        <StepOne
          {...defaultProps}
          dataSourceType={DataSourceType.WEB}
          websitePages={websitePages}
          onStepChange={onStepChange}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      // Assert
      expect(onStepChange).toHaveBeenCalled()
    })
  })
})
