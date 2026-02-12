import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { NotionPage } from '@/models/common'
import type { CrawlOptions, CrawlResultItem, DataSet, FileItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { DataSourceType } from '@/models/datasets'
import StepOne from '../index'

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

vi.mock('../../file-uploader', () => ({
  default: ({ onPreview, fileList }: { onPreview: (file: File) => void, fileList: FileItem[] }) => (
    <div data-testid="file-uploader">
      <span data-testid="file-count">{fileList.length}</span>
      <button data-testid="preview-file" onClick={() => onPreview(new File(['test'], 'test.txt'))}>
        Preview
      </button>
    </div>
  ),
}))

vi.mock('../../website', () => ({
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

vi.mock('../../empty-dataset-creation-modal', () => ({
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

vi.mock('../../file-preview', () => ({
  default: ({ file, hidePreview }: { file: File, hidePreview: () => void }) => (
    <div data-testid="file-preview">
      <span>{file.name}</span>
      <button data-testid="hide-file-preview" onClick={hidePreview}>Hide</button>
    </div>
  ),
}))

vi.mock('../../notion-page-preview', () => ({
  default: ({ currentPage, hidePreview }: { currentPage: NotionPage, hidePreview: () => void }) => (
    <div data-testid="notion-page-preview">
      <span>{currentPage.page_id}</span>
      <button data-testid="hide-notion-preview" onClick={hidePreview}>Hide</button>
    </div>
  ),
}))

// WebsitePreview is a sibling component without API dependencies - imported directly
// It only depends on i18n which is globally mocked

vi.mock('../upgrade-card', () => ({
  default: () => <div data-testid="upgrade-card">Upgrade Card</div>,
}))

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

// NOTE: Child component unit tests (usePreviewState, DataSourceTypeSelector,
// NextStepButton, PreviewPanel) have been moved to their own dedicated spec files:
//   - ./hooks/use-preview-state.spec.ts
//   - ./components/data-source-type-selector.spec.tsx
//   - ./components/next-step-button.spec.tsx
//   - ./components/preview-panel.spec.tsx
// This file now focuses exclusively on StepOne parent component tests.

// StepOne Component Tests
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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<StepOne {...defaultProps} />)

      expect(screen.getByText('datasetCreation.steps.one')).toBeInTheDocument()
    })

    it('should render DataSourceTypeSelector when not editing existing dataset', () => {
      render(<StepOne {...defaultProps} />)

      expect(screen.getByText('datasetCreation.stepOne.dataSourceType.file')).toBeInTheDocument()
    })

    it('should render FileUploader when dataSourceType is FILE', () => {
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.FILE} />)

      expect(screen.getByTestId('file-uploader')).toBeInTheDocument()
    })

    it('should render NotionConnector when dataSourceType is NOTION and not authenticated', () => {
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} />)

      // Assert - NotionConnector shows sync title and connect button
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.connect/i })).toBeInTheDocument()
    })

    it('should render NotionPageSelector when dataSourceType is NOTION and authenticated', () => {
      const authedDataSourceList = [createMockDataSourceAuth()]

      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={authedDataSourceList} />)

      expect(screen.getByTestId('notion-page-selector')).toBeInTheDocument()
    })

    it('should render Website when dataSourceType is WEB', () => {
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.WEB} />)

      expect(screen.getByTestId('website')).toBeInTheDocument()
    })

    it('should render empty dataset creation link when no datasetId', () => {
      render(<StepOne {...defaultProps} />)

      expect(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation')).toBeInTheDocument()
    })

    it('should not render empty dataset creation link when datasetId exists', () => {
      render(<StepOne {...defaultProps} datasetId="dataset-123" />)

      expect(screen.queryByText('datasetCreation.stepOne.emptyDatasetCreation')).not.toBeInTheDocument()
    })
  })

  // Props Tests
  describe('Props', () => {
    it('should pass files to FileUploader', () => {
      const files = [createMockFileItem()]

      render(<StepOne {...defaultProps} files={files} />)

      expect(screen.getByTestId('file-count')).toHaveTextContent('1')
    })

    it('should call onSetting when NotionConnector connect button is clicked', () => {
      const onSetting = vi.fn()
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} onSetting={onSetting} />)

      // Act - The NotionConnector's button calls onSetting
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.connect/i }))

      expect(onSetting).toHaveBeenCalledTimes(1)
    })

    it('should call changeType when data source type is changed', () => {
      const changeType = vi.fn()
      render(<StepOne {...defaultProps} changeType={changeType} />)

      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      expect(changeType).toHaveBeenCalledWith(DataSourceType.NOTION)
    })
  })

  describe('State Management', () => {
    it('should open empty dataset modal when link is clicked', () => {
      render(<StepOne {...defaultProps} />)

      fireEvent.click(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation'))

      expect(screen.getByTestId('empty-dataset-modal')).toBeInTheDocument()
    })

    it('should close empty dataset modal when close is clicked', () => {
      render(<StepOne {...defaultProps} />)
      fireEvent.click(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation'))

      fireEvent.click(screen.getByTestId('close-modal'))

      expect(screen.queryByTestId('empty-dataset-modal')).not.toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should correctly compute isNotionAuthed based on authedDataSourceList', () => {
      // Arrange - No auth
      const { rerender } = render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} />)
      // NotionConnector shows the sync title when not authenticated
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()

      // Act - Add auth
      const authedDataSourceList = [createMockDataSourceAuth()]
      rerender(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={authedDataSourceList} />)

      expect(screen.getByTestId('notion-page-selector')).toBeInTheDocument()
    })

    it('should correctly compute fileNextDisabled when files are empty', () => {
      render(<StepOne {...defaultProps} files={[]} />)

      // Assert - Button should be disabled
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should correctly compute fileNextDisabled when files are loaded', () => {
      const files = [createMockFileItem()]

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

      render(<StepOne {...defaultProps} files={[fileItem]} />)

      // Assert - Button should be disabled
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })
  })

  describe('Callbacks', () => {
    it('should call onStepChange when next button is clicked with valid files', () => {
      const onStepChange = vi.fn()
      const files = [createMockFileItem()]
      render(<StepOne {...defaultProps} files={files} onStepChange={onStepChange} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should show plan upgrade modal when batch upload not supported and multiple files', () => {
      mockEnableBilling = true
      mockPlan.type = Plan.sandbox
      const files = [createMockFileItem(), createMockFileItem()]
      render(<StepOne {...defaultProps} files={files} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(screen.getByTestId('plan-upgrade-modal')).toBeInTheDocument()
    })

    it('should show upgrade card when in sandbox plan with files', () => {
      mockEnableBilling = true
      mockPlan.type = Plan.sandbox
      const files = [createMockFileItem()]

      render(<StepOne {...defaultProps} files={files} />)

      expect(screen.getByTestId('upgrade-card')).toBeInTheDocument()
    })
  })

  // Vector Space Full Tests
  describe('Vector Space Full', () => {
    it('should show VectorSpaceFull when vector space is full and billing is enabled', () => {
      mockEnableBilling = true
      mockPlan.usage.vectorSpace = 100
      mockPlan.total.vectorSpace = 100
      const files = [createMockFileItem()]

      render(<StepOne {...defaultProps} files={files} />)

      expect(screen.getByTestId('vector-space-full')).toBeInTheDocument()
    })

    it('should disable next button when vector space is full', () => {
      mockEnableBilling = true
      mockPlan.usage.vectorSpace = 100
      mockPlan.total.vectorSpace = 100
      const files = [createMockFileItem()]

      render(<StepOne {...defaultProps} files={files} />)

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })
  })

  // Preview Integration Tests
  describe('Preview Integration', () => {
    it('should show file preview when file preview button is clicked', () => {
      render(<StepOne {...defaultProps} />)

      fireEvent.click(screen.getByTestId('preview-file'))

      expect(screen.getByTestId('file-preview')).toBeInTheDocument()
    })

    it('should hide file preview when hide button is clicked', () => {
      render(<StepOne {...defaultProps} />)
      fireEvent.click(screen.getByTestId('preview-file'))

      fireEvent.click(screen.getByTestId('hide-file-preview'))

      expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
    })

    it('should show notion page preview when preview button is clicked', () => {
      const authedDataSourceList = [createMockDataSourceAuth()]
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={authedDataSourceList} />)

      fireEvent.click(screen.getByTestId('preview-notion'))

      expect(screen.getByTestId('notion-page-preview')).toBeInTheDocument()
    })

    it('should show website preview when preview button is clicked', () => {
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.WEB} />)

      fireEvent.click(screen.getByTestId('preview-website'))

      // Assert - Check for pagePreview title which is shown by WebsitePreview
      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty notionPages array', () => {
      const authedDataSourceList = [createMockDataSourceAuth()]

      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} notionPages={[]} authedDataSourceList={authedDataSourceList} />)

      // Assert - Button should be disabled when no pages selected
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should handle empty websitePages array', () => {
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.WEB} websitePages={[]} />)

      // Assert - Button should be disabled when no pages crawled
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should handle empty authedDataSourceList', () => {
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={[]} />)

      // Assert - Should show NotionConnector with connect button
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()
    })

    it('should handle authedDataSourceList without notion credentials', () => {
      const authedDataSourceList = [createMockDataSourceAuth({ credentials_list: [] })]

      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} authedDataSourceList={authedDataSourceList} />)

      // Assert - Should show NotionConnector with connect button
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()
    })

    it('should clear previews when switching data source types', () => {
      render(<StepOne {...defaultProps} />)
      fireEvent.click(screen.getByTestId('preview-file'))
      expect(screen.getByTestId('file-preview')).toBeInTheDocument()

      // Act - Change to NOTION
      fireEvent.click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      // Assert - File preview should be cleared
      expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
    })
  })

  describe('Integration', () => {
    it('should complete file upload flow', () => {
      const onStepChange = vi.fn()
      const files = [createMockFileItem()]

      render(<StepOne {...defaultProps} files={files} onStepChange={onStepChange} />)
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(onStepChange).toHaveBeenCalled()
    })

    it('should complete notion page selection flow', () => {
      const onStepChange = vi.fn()
      const authedDataSourceList = [createMockDataSourceAuth()]
      const notionPages = [createMockNotionPage()]

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

      expect(onStepChange).toHaveBeenCalled()
    })

    it('should complete website crawl flow', () => {
      const onStepChange = vi.fn()
      const websitePages = [createMockCrawlResult()]

      render(
        <StepOne
          {...defaultProps}
          dataSourceType={DataSourceType.WEB}
          websitePages={websitePages}
          onStepChange={onStepChange}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(onStepChange).toHaveBeenCalled()
    })
  })
})
