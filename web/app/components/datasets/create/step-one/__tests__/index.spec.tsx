import type { DatasourceProviderAuthResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { NotionPage } from '@/models/common'
import type { CrawlOptions, CrawlResultItem, FileItem } from '@/models/datasets'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { DataSourceType } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import StepOne from '../index'

vi.mock('@tanstack/react-virtual')

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'notion.preImport.pages.get': async () => ({
        notion_info: [
          {
            workspace_id: 'workspace-1',
            workspace_name: 'Workspace 1',
            workspace_icon: null,
            pages: [
              {
                page_id: 'page-1',
                page_name: 'Page',
                parent_id: null,
                page_icon: null,
                is_bound: false,
                type: 'page',
              },
            ],
          },
        ],
      }),
      'notion.pages.byPageId.byPageType.preview.get': async () => ({
        content: 'Notion page contents',
      }),
    }),
  }
})

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const createMockCustomFile = (overrides: { id?: string; name?: string } = {}) => {
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
  file: createMockCustomFile(overrides.file as { id?: string; name?: string }),
  progress: 100,
  ...overrides,
})

let mockPlan: {
  type: CloudPlan
  usage: {
    vectorSpace: number
    buildApps: number
    documentsUploadQuota: number
    vectorStorageQuota: number
  }
  total: {
    vectorSpace: number
    buildApps: number
    documentsUploadQuota: number
    vectorStorageQuota: number
  }
} = {
  type: 'professional',
  usage: { vectorSpace: 50, buildApps: 0, documentsUploadQuota: 0, vectorStorageQuota: 0 },
  total: { vectorSpace: 100, buildApps: 0, documentsUploadQuota: 0, vectorStorageQuota: 0 },
}

let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'COMMUNITY'

const render = (ui: React.ReactElement, vectorSpaceUsageUnknown = false) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryOptions().queryKey, {
    size: mockPlan.usage.vectorSpace,
    limit: mockPlan.total.vectorSpace,
    usage_unknown: vectorSpaceUsageUnknown,
  })
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: deploymentEdition },
    queryClient,
    features: { billing: { subscription: { plan: mockPlan.type } } },
  })
  return renderWithConsoleState(ui, {
    wrapper: ({ children }) => (
      <NuqsTestingAdapter>
        <QueryWrapper>{children}</QueryWrapper>
      </NuqsTestingAdapter>
    ),
  })
}

// Mock config for website crawl features
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_WEBSITE_FIRECRAWL: true,
  ENABLE_WEBSITE_JINAREADER: false,
  ENABLE_WEBSITE_WATERCRAWL: false,
}))

// Mock dataset detail context
let mockDatasetDetail: DatasetDetailWithPartialMembersResponse | undefined
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: {
      dataset: DatasetDetailWithPartialMembersResponse | undefined
    }) => DatasetDetailWithPartialMembersResponse | undefined,
  ) => {
    return selector({ dataset: mockDatasetDetail })
  },
}))

// Mock provider context

vi.mock('../../file-uploader', () => ({
  default: ({ onPreview, fileList }: { onPreview: (file: File) => void; fileList: FileItem[] }) => (
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
        onClick={() =>
          onPreview({
            title: 'Test',
            markdown: '',
            description: '',
            source_url: 'https://test.com',
          })
        }
      >
        Preview Website
      </button>
    </div>
  ),
}))

const createMockNotionPage = (overrides: Partial<NotionPage> = {}): NotionPage => ({
  page_id: 'page-1',
  type: 'page',
  page_icon: null,
  page_name: 'Page',
  parent_id: '',
  is_bound: false,
  workspace_id: 'workspace-1',
  ...overrides,
})

const createMockCrawlResult = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Page',
  markdown: 'Test content',
  description: 'Test description',
  source_url: 'https://example.com',
  ...overrides,
})

const createMockDataSourceAuth = (
  overrides: Partial<DatasourceProviderAuthResponse> = {},
): DatasourceProviderAuthResponse => ({
  author: 'Dify',
  credential_schema: [],
  description: { en_US: 'Notion', zh_Hans: 'Notion' },
  label: { en_US: 'Notion', zh_Hans: 'Notion' },
  icon: '',
  name: 'notion',
  oauth_schema: null,
  plugin_unique_identifier: 'notion:1',
  provider: 'notion_datasource',
  plugin_id: 'plugin-1',
  credentials_list: [
    {
      id: 'cred-1',
      name: 'Workspace 1',
      avatar_url: null,
      credential: {},
      is_default: true,
      type: 'oauth2',
    },
  ],
  ...overrides,
})

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
  authedDataSourceList: [] as DatasourceProviderAuthResponse[],
}

describe('StepOne', () => {
  it('returns keyboard focus to the file preview trigger when closing the preview', async () => {
    const user = userEvent.setup()
    render(<StepOne {...defaultProps} />)
    const trigger = screen.getByRole('button', { name: 'Preview' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(
      screen.queryByRole('region', { name: 'datasetCreation.stepOne.filePreview' }),
    ).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps focus on the newly selected data source when clearing a file preview', async () => {
    const user = userEvent.setup()
    render(<StepOne {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    const source = screen.getByRole('radio', { name: 'datasetCreation.stepOne.dataSourceType.web' })
    await user.click(source)
    expect(
      screen.queryByRole('region', { name: 'datasetCreation.stepOne.filePreview' }),
    ).not.toBeInTheDocument()
    expect(source).toHaveFocus()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetDetail = undefined
    mockPlan = {
      type: 'professional',
      usage: { vectorSpace: 50, buildApps: 0, documentsUploadQuota: 0, vectorStorageQuota: 0 },
      total: { vectorSpace: 100, buildApps: 0, documentsUploadQuota: 0, vectorStorageQuota: 0 },
    }
    deploymentEdition = 'COMMUNITY'
  })

  describe('Rendering', () => {
    it('should not render empty dataset creation link when datasetId exists', () => {
      render(<StepOne {...defaultProps} datasetId="dataset-123" />)

      expect(
        screen.queryByText('datasetCreation.stepOne.emptyDatasetCreation'),
      ).not.toBeInTheDocument()
    })
  })

  // Props Tests
  describe('Props', () => {
    it('should call onSetting when NotionConnector connect button is clicked', async () => {
      const onSetting = vi.fn()
      render(
        <StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} onSetting={onSetting} />,
      )

      // Act - The NotionConnector's button calls onSetting
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: /datasetCreation.stepOne.connect/i }))

      expect(onSetting).toHaveBeenCalledTimes(1)
    })

    it('should call changeType when data source type is changed', async () => {
      const changeType = vi.fn()
      render(<StepOne {...defaultProps} changeType={changeType} />)

      await userEvent
        .setup()
        .click(screen.getByText('datasetCreation.stepOne.dataSourceType.notion'))

      expect(changeType).toHaveBeenCalledWith(DataSourceType.NOTION)
    })
  })

  describe('State Management', () => {
    it('should close empty dataset modal when close is clicked', async () => {
      render(<StepOne {...defaultProps} />)
      await userEvent
        .setup()
        .click(screen.getByText('datasetCreation.stepOne.emptyDatasetCreation'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'datasetCreation.stepOne.modal.cancelButton' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  describe('Authentication and upload readiness', () => {
    it('replaces the connection prompt with page selection after authentication', async () => {
      // Arrange - No auth
      const { rerender } = render(
        <StepOne {...defaultProps} dataSourceType={DataSourceType.NOTION} />,
      )
      // NotionConnector shows the sync title when not authenticated
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()

      // Act - Add auth
      const authedDataSourceList = [createMockDataSourceAuth()]
      rerender(
        <StepOne
          {...defaultProps}
          dataSourceType={DataSourceType.NOTION}
          authedDataSourceList={authedDataSourceList}
        />,
      )

      expect(await screen.findByRole('combobox', { name: 'Workspace 1' })).toBeInTheDocument()
      expect(await screen.findByText('Page')).toBeInTheDocument()
    })

    it('should correctly compute fileNextDisabled when files are empty', () => {
      render(<StepOne {...defaultProps} files={[]} />)

      // Assert - Button should be disabled
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
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
    it('should show plan upgrade modal when batch upload not supported and multiple files', async () => {
      deploymentEdition = 'CLOUD'
      mockPlan.type = 'sandbox'
      const files = [createMockFileItem(), createMockFileItem()]
      render(<StepOne {...defaultProps} files={files} />)

      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(defaultProps.onStepChange).not.toHaveBeenCalled()
    })

    it('should show upgrade card immediately when in sandbox plan', () => {
      deploymentEdition = 'CLOUD'
      mockPlan.type = 'sandbox'

      render(<StepOne {...defaultProps} files={[]} />)

      expect(screen.getByText('billing.upgrade.uploadMultipleFiles.title')).toBeInTheDocument()
    })
  })

  // Vector Space Full Tests
  describe('Vector Space Full', () => {
    it('blocks continuing when vector space is full', () => {
      deploymentEdition = 'CLOUD'
      mockPlan.usage.vectorSpace = 100
      mockPlan.total.vectorSpace = 100
      const files = [createMockFileItem()]

      render(<StepOne {...defaultProps} files={files} />)

      expect(screen.getByText('billing.vectorSpace.fullTip')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should require sandbox users to retry when vector space usage is unknown', () => {
      deploymentEdition = 'CLOUD'
      mockPlan.type = 'sandbox'
      mockPlan.usage.vectorSpace = 100
      mockPlan.total.vectorSpace = 100
      const files = [createMockFileItem()]

      render(<StepOne {...defaultProps} files={files} />, true)

      expect(screen.queryByText('billing.vectorSpace.fullTip')).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('billing.plansCommon.unavailable')
      expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should allow paid users to continue when vector space usage is unknown', () => {
      deploymentEdition = 'CLOUD'
      mockPlan.type = 'professional'
      const files = [createMockFileItem()]

      render(<StepOne {...defaultProps} files={files} />, true)

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeEnabled()
    })
  })

  // Preview Integration Tests
  describe('Preview Integration', () => {
    it('should show notion page preview when preview button is clicked', async () => {
      const authedDataSourceList = [createMockDataSourceAuth()]
      render(
        <StepOne
          {...defaultProps}
          dataSourceType={DataSourceType.NOTION}
          notionCredentialId="cred-1"
          authedDataSourceList={authedDataSourceList}
        />,
      )

      await userEvent.setup().click(await screen.findByTestId('notion-page-preview-page-1'))

      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
      expect(await screen.findByText('Notion page contents')).toBeInTheDocument()
    })

    it('should show website preview when preview button is clicked', async () => {
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.WEB} />)

      await userEvent.setup().click(screen.getByTestId('preview-website'))

      // Assert - Check for pagePreview title which is shown by WebsitePreview
      expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty notionPages array', () => {
      const authedDataSourceList = [createMockDataSourceAuth()]

      render(
        <StepOne
          {...defaultProps}
          dataSourceType={DataSourceType.NOTION}
          notionPages={[]}
          authedDataSourceList={authedDataSourceList}
        />,
      )

      // Assert - Button should be disabled when no pages selected
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should handle empty websitePages array', () => {
      render(<StepOne {...defaultProps} dataSourceType={DataSourceType.WEB} websitePages={[]} />)

      // Assert - Button should be disabled when no pages crawled
      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should handle authedDataSourceList without notion credentials', () => {
      const authedDataSourceList = [createMockDataSourceAuth({ credentials_list: [] })]

      render(
        <StepOne
          {...defaultProps}
          dataSourceType={DataSourceType.NOTION}
          authedDataSourceList={authedDataSourceList}
        />,
      )

      // Assert - Should show NotionConnector with connect button
      expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()
    })
  })

  describe('Integration', () => {
    it('should complete file upload flow', async () => {
      const onStepChange = vi.fn()
      const files = [createMockFileItem()]

      render(<StepOne {...defaultProps} files={files} onStepChange={onStepChange} />)
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should complete notion page selection flow', async () => {
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
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should complete website crawl flow', async () => {
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
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(onStepChange).toHaveBeenCalledTimes(1)
    })
  })
})
