import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile, DocumentItem, FileItem } from '@/models/datasets'
import type { InitialDocumentDetail, OnlineDriveFile } from '@/models/pipeline'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { DatasourceType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'
import {
  useAddDocumentsSteps,
  useDatasourceActions,
  useDatasourceOptions,
  useDatasourceUIState,
  useLocalFile,
  useOnlineDocument,
  useOnlineDrive,
  useWebsiteCrawl,
} from './hooks'
import { StepOneContent, StepThreeContent, StepTwoContent } from './steps'
import { StepOnePreview, StepTwoPreview } from './steps/preview-panel'
import {
  buildLocalFileDatasourceInfo,
  buildOnlineDocumentDatasourceInfo,
  buildOnlineDriveDatasourceInfo,
  buildWebsiteCrawlDatasourceInfo,
} from './utils/datasource-info-builder'

// ==========================================
// Mock External Dependencies Only
// ==========================================

// Mock context providers
const mockPlan = {
  usage: { vectorSpace: 50 },
  total: { vectorSpace: 100 },
  type: 'professional',
}

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (selector: (state: { plan: typeof mockPlan, enableBilling: boolean }) => unknown) =>
    selector({ plan: mockPlan, enableBilling: true }),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: { pipeline_id: string } }) => unknown) =>
    selector({ dataset: { pipeline_id: 'test-pipeline-id' } }),
}))

// Mock API services
const mockRunPublishedPipeline = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  usePublishedPipelineInfo: () => ({
    data: {
      graph: {
        nodes: [
          {
            id: 'node-1',
            data: {
              type: 'data-source',
              title: 'Local File',
              provider_type: DatasourceType.localFile,
              plugin_id: 'plugin-1',
              fileExtensions: ['.txt', '.pdf'],
            },
          },
        ],
      },
    },
    isFetching: false,
  }),
  useRunPublishedPipeline: () => ({
    mutateAsync: mockRunPublishedPipeline,
    isIdle: true,
    isPending: false,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: {
      file_size_limit: 15,
      batch_count_limit: 5,
    },
  }),
}))

// Mock amplitude tracking
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({ datasetId: 'test-dataset-id' }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/datasets/test-dataset-id/documents/create-from-pipeline',
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock billing components (external dependencies)
vi.mock('@/app/components/billing/vector-space-full', () => ({
  default: () => <div data-testid="vector-space-full">Vector Space Full</div>,
}))

vi.mock('@/app/components/billing/plan-upgrade-modal', () => ({
  default: ({ show, onClose }: { show: boolean, onClose: () => void }) => (
    show
      ? (
          <div data-testid="plan-upgrade-modal">
            <button data-testid="close-modal" onClick={onClose}>Close</button>
          </div>
        )
      : null
  ),
}))

vi.mock('@/app/components/datasets/create/step-one/upgrade-card', () => ({
  default: () => <div data-testid="upgrade-card">Upgrade Card</div>,
}))

// Mock zustand store
// eslint-disable-next-line ts/no-explicit-any
type MockDataSourceStore = any

const mockStoreState = {
  localFileList: [] as FileItem[],
  currentLocalFile: undefined as CustomFile | undefined,
  setCurrentLocalFile: vi.fn(),
  documentsData: [] as { workspace_id: string, pages: { page_id: string }[] }[],
  onlineDocuments: [] as (NotionPage & { workspace_id: string })[],
  currentDocument: undefined as (NotionPage & { workspace_id: string }) | undefined,
  setDocumentsData: vi.fn(),
  setSearchValue: vi.fn(),
  setSelectedPagesId: vi.fn(),
  setOnlineDocuments: vi.fn(),
  setCurrentDocument: vi.fn(),
  websitePages: [] as CrawlResultItem[],
  currentWebsite: undefined as CrawlResultItem | undefined,
  setCurrentWebsite: vi.fn(),
  setPreviewIndex: vi.fn(),
  setStep: vi.fn(),
  setCrawlResult: vi.fn(),
  setWebsitePages: vi.fn(),
  onlineDriveFileList: [] as OnlineDriveFile[],
  selectedFileIds: [] as string[],
  setOnlineDriveFileList: vi.fn(),
  setBucket: vi.fn(),
  setPrefix: vi.fn(),
  setKeywords: vi.fn(),
  setSelectedFileIds: vi.fn(),
  previewLocalFileRef: { current: undefined },
  previewOnlineDocumentRef: { current: undefined },
  previewWebsitePageRef: { current: undefined },
  previewOnlineDriveFileRef: { current: undefined },
  currentCredentialId: '',
  setCurrentCredentialId: vi.fn(),
  currentNodeIdRef: { current: '' },
  bucket: '',
}

vi.mock('./data-source/store', () => ({
  useDataSourceStore: () => ({
    getState: () => mockStoreState,
  }),
  useDataSourceStoreWithSelector: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
}))

vi.mock('./data-source/store/provider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ==========================================
// Test Data Factories
// ==========================================

const createMockDatasource = (overrides?: Partial<Datasource>): Datasource => ({
  nodeId: 'node-1',
  nodeData: {
    type: 'data-source',
    title: 'Local File',
    desc: '',
    provider_type: DatasourceType.localFile,
    plugin_id: 'plugin-1',
    provider_name: 'local',
    datasource_name: 'local-file',
    datasource_label: 'Local File',
    fileExtensions: ['.txt', '.pdf'],
  } as unknown as DataSourceNodeType,
  ...overrides,
})

const createMockFile = (overrides?: Partial<CustomFile>): CustomFile => ({
  id: 'file-1',
  name: 'test.txt',
  type: 'text/plain',
  size: 1024,
  extension: '.txt',
  mime_type: 'text/plain',
  ...overrides,
} as CustomFile)

const createMockFileItem = (overrides?: Partial<FileItem>): FileItem => ({
  file: createMockFile(),
  progress: 100,
  ...overrides,
} as FileItem)

const createMockNotionPage = (overrides?: Partial<NotionPage & { workspace_id: string }>): NotionPage & { workspace_id: string } => ({
  page_id: 'page-1',
  page_name: 'Test Page',
  page_icon: null,
  type: 'page',
  workspace_id: 'workspace-1',
  ...overrides,
} as NotionPage & { workspace_id: string })

const createMockCrawlResult = (overrides?: Partial<CrawlResultItem>): CrawlResultItem => ({
  source_url: 'https://example.com',
  title: 'Test Page',
  markdown: '# Test',
  description: 'A test page',
  ...overrides,
} as CrawlResultItem)

const createMockOnlineDriveFile = (overrides?: Partial<OnlineDriveFile>): OnlineDriveFile => ({
  id: 'drive-file-1',
  name: 'test-file.pdf',
  type: 'file',
  ...overrides,
} as OnlineDriveFile)

// ==========================================
// Hook Tests - useAddDocumentsSteps
// ==========================================
describe('useAddDocumentsSteps', () => {
  it('should initialize with step 1', () => {
    const { result } = renderHook(() => useAddDocumentsSteps())
    expect(result.current.currentStep).toBe(1)
  })

  it('should return 3 steps', () => {
    const { result } = renderHook(() => useAddDocumentsSteps())
    expect(result.current.steps).toHaveLength(3)
  })

  it('should increment step when handleNextStep is called', () => {
    const { result } = renderHook(() => useAddDocumentsSteps())

    act(() => {
      result.current.handleNextStep()
    })

    expect(result.current.currentStep).toBe(2)
  })

  it('should decrement step when handleBackStep is called', () => {
    const { result } = renderHook(() => useAddDocumentsSteps())

    act(() => {
      result.current.handleNextStep()
      result.current.handleBackStep()
    })

    expect(result.current.currentStep).toBe(1)
  })

  it('should maintain callback reference stability (handleNextStep)', () => {
    const { result, rerender } = renderHook(() => useAddDocumentsSteps())
    const firstRef = result.current.handleNextStep
    rerender()
    expect(result.current.handleNextStep).toBe(firstRef)
  })

  it('should maintain callback reference stability (handleBackStep)', () => {
    const { result, rerender } = renderHook(() => useAddDocumentsSteps())
    const firstRef = result.current.handleBackStep
    rerender()
    expect(result.current.handleBackStep).toBe(firstRef)
  })
})

// ==========================================
// Hook Tests - useDatasourceUIState
// ==========================================
describe('useDatasourceUIState', () => {
  const defaultParams = {
    datasource: undefined as Datasource | undefined,
    allFileLoaded: false,
    localFileListLength: 0,
    onlineDocumentsLength: 0,
    websitePagesLength: 0,
    selectedFileIdsLength: 0,
    onlineDriveFileList: [] as OnlineDriveFile[],
    isVectorSpaceFull: false,
    enableBilling: true,
    currentWorkspacePagesLength: 0,
    fileUploadConfig: { file_size_limit: 15, batch_count_limit: 5 },
  }

  describe('nextBtnDisabled', () => {
    it('should return true when no datasource is selected', () => {
      const { result } = renderHook(() => useDatasourceUIState(defaultParams))
      expect(result.current.nextBtnDisabled).toBe(true)
    })

    it('should return true for localFile when no files are loaded', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource(),
        allFileLoaded: false,
        localFileListLength: 0,
      }))
      expect(result.current.nextBtnDisabled).toBe(true)
    })

    it('should return false for localFile when files are loaded', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource(),
        allFileLoaded: true,
        localFileListLength: 1,
      }))
      expect(result.current.nextBtnDisabled).toBe(false)
    })

    it('should return true for onlineDocument when no documents are selected', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.onlineDocument,
          },
        }),
        onlineDocumentsLength: 0,
      }))
      expect(result.current.nextBtnDisabled).toBe(true)
    })

    it('should return false for onlineDocument when documents are selected', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.onlineDocument,
          },
        }),
        onlineDocumentsLength: 1,
      }))
      expect(result.current.nextBtnDisabled).toBe(false)
    })
  })

  describe('isShowVectorSpaceFull', () => {
    it('should return false when vector space is not full', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource(),
        allFileLoaded: true,
        isVectorSpaceFull: false,
      }))
      expect(result.current.isShowVectorSpaceFull).toBe(false)
    })

    it('should return true when vector space is full and billing is enabled', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource(),
        allFileLoaded: true,
        isVectorSpaceFull: true,
        enableBilling: true,
      }))
      expect(result.current.isShowVectorSpaceFull).toBe(true)
    })

    it('should return false when vector space is full but billing is disabled', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource(),
        allFileLoaded: true,
        isVectorSpaceFull: true,
        enableBilling: false,
      }))
      expect(result.current.isShowVectorSpaceFull).toBe(false)
    })
  })

  describe('showSelect', () => {
    it('should return false for localFile datasource', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource(),
      }))
      expect(result.current.showSelect).toBe(false)
    })

    it('should return true for onlineDocument when pages exist', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.onlineDocument,
          },
        }),
        currentWorkspacePagesLength: 5,
      }))
      expect(result.current.showSelect).toBe(true)
    })

    it('should return true for onlineDrive when non-bucket files exist', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.onlineDrive,
          },
        }),
        onlineDriveFileList: [createMockOnlineDriveFile()],
      }))
      expect(result.current.showSelect).toBe(true)
    })

    it('should return false for onlineDrive when only buckets exist', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.onlineDrive,
          },
        }),
        onlineDriveFileList: [createMockOnlineDriveFile({ type: 'bucket' as OnlineDriveFile['type'] })],
      }))
      expect(result.current.showSelect).toBe(false)
    })
  })

  describe('tip', () => {
    it('should return empty string for localFile', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource(),
      }))
      expect(result.current.tip).toBe('')
    })

    it('should return translation key for onlineDocument', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        ...defaultParams,
        datasource: createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.onlineDocument,
          },
        }),
      }))
      expect(result.current.tip).toContain('datasetPipeline.addDocuments.selectOnlineDocumentTip')
    })
  })
})

// ==========================================
// Utility Functions Tests - datasource-info-builder
// ==========================================
describe('datasource-info-builder', () => {
  describe('buildLocalFileDatasourceInfo', () => {
    it('should build correct info for local file', () => {
      const file = createMockFile()
      const result = buildLocalFileDatasourceInfo(file, 'cred-1')

      expect(result).toEqual({
        related_id: 'file-1',
        name: 'test.txt',
        type: 'text/plain',
        size: 1024,
        extension: '.txt',
        mime_type: 'text/plain',
        url: '',
        transfer_method: TransferMethod.local_file,
        credential_id: 'cred-1',
      })
    })

    it('should handle file with undefined id', () => {
      const file = createMockFile({ id: undefined })
      const result = buildLocalFileDatasourceInfo(file, 'cred-1')
      expect(result.related_id).toBeUndefined()
    })
  })

  describe('buildOnlineDocumentDatasourceInfo', () => {
    it('should build correct info for online document', () => {
      const page = createMockNotionPage()
      const result = buildOnlineDocumentDatasourceInfo(page, 'cred-1')

      expect(result.workspace_id).toBe('workspace-1')
      expect(result.credential_id).toBe('cred-1')
      expect(result.page).toBeDefined()
      expect((result.page as NotionPage).page_id).toBe('page-1')
    })

    it('should exclude workspace_id from page object', () => {
      const page = createMockNotionPage()
      const result = buildOnlineDocumentDatasourceInfo(page, 'cred-1')

      expect((result.page as Record<string, unknown>).workspace_id).toBeUndefined()
    })
  })

  describe('buildWebsiteCrawlDatasourceInfo', () => {
    it('should build correct info for website crawl', () => {
      const page = createMockCrawlResult()
      const result = buildWebsiteCrawlDatasourceInfo(page, 'cred-1')

      expect(result.source_url).toBe('https://example.com')
      expect(result.credential_id).toBe('cred-1')
    })

    it('should spread all page properties', () => {
      const page = createMockCrawlResult({ title: 'Custom Title' })
      const result = buildWebsiteCrawlDatasourceInfo(page, 'cred-1')

      expect(result.title).toBe('Custom Title')
    })
  })

  describe('buildOnlineDriveDatasourceInfo', () => {
    it('should build correct info for online drive', () => {
      const file = createMockOnlineDriveFile()
      const result = buildOnlineDriveDatasourceInfo(file, 'my-bucket', 'cred-1')

      expect(result).toEqual({
        bucket: 'my-bucket',
        id: 'drive-file-1',
        name: 'test-file.pdf',
        type: 'file',
        credential_id: 'cred-1',
      })
    })
  })
})

// ==========================================
// Step Components Tests (with real components)
// ==========================================
describe('StepOneContent', () => {
  const defaultProps = {
    datasource: undefined as Datasource | undefined,
    datasourceType: undefined as string | undefined,
    pipelineNodes: [] as Node<DataSourceNodeType>[],
    supportBatchUpload: true,
    localFileListLength: 0,
    isShowVectorSpaceFull: false,
    showSelect: false,
    totalOptions: undefined as number | undefined,
    selectedOptions: undefined as number | undefined,
    tip: '',
    nextBtnDisabled: true,
    onSelectDataSource: vi.fn(),
    onCredentialChange: vi.fn(),
    onSelectAll: vi.fn(),
    onNextStep: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render VectorSpaceFull when isShowVectorSpaceFull is true', () => {
    render(<StepOneContent {...defaultProps} isShowVectorSpaceFull={true} />)
    expect(screen.getByTestId('vector-space-full')).toBeInTheDocument()
  })

  it('should not render VectorSpaceFull when isShowVectorSpaceFull is false', () => {
    render(<StepOneContent {...defaultProps} isShowVectorSpaceFull={false} />)
    expect(screen.queryByTestId('vector-space-full')).not.toBeInTheDocument()
  })

  it('should render UpgradeCard when conditions are met', () => {
    render(
      <StepOneContent
        {...defaultProps}
        datasource={createMockDatasource()}
        supportBatchUpload={false}
        datasourceType={DatasourceType.localFile}
        localFileListLength={2}
      />,
    )
    expect(screen.getByTestId('upgrade-card')).toBeInTheDocument()
  })

  it('should not render UpgradeCard when supportBatchUpload is true', () => {
    render(
      <StepOneContent
        {...defaultProps}
        datasource={createMockDatasource()}
        supportBatchUpload={true}
        datasourceType={DatasourceType.localFile}
        localFileListLength={2}
      />,
    )
    expect(screen.queryByTestId('upgrade-card')).not.toBeInTheDocument()
  })

  it('should call onNextStep when next button is clicked', () => {
    const onNextStep = vi.fn()
    render(<StepOneContent {...defaultProps} nextBtnDisabled={false} onNextStep={onNextStep} />)

    // Find button with translation key text (using regex for flexibility)
    const nextButton = screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })
    fireEvent.click(nextButton)

    expect(onNextStep).toHaveBeenCalled()
  })

  it('should disable next button when nextBtnDisabled is true', () => {
    render(<StepOneContent {...defaultProps} nextBtnDisabled={true} />)

    const nextButton = screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })
    expect(nextButton).toBeDisabled()
  })
})

describe('StepTwoContent', () => {
  // Mock ProcessDocuments since it has complex dependencies
  vi.mock('./process-documents', () => ({
    default: React.forwardRef(({ dataSourceNodeId, isRunning, onProcess, onPreview, onSubmit, onBack }: {
      dataSourceNodeId: string
      isRunning: boolean
      onProcess: () => void
      onPreview: () => void
      onSubmit: (data: Record<string, unknown>) => void
      onBack: () => void
    }, ref: React.Ref<{ submit: () => void }>) => {
      React.useImperativeHandle(ref, () => ({
        submit: () => onSubmit({ test: 'data' }),
      }))
      return (
        <div data-testid="process-documents">
          <span data-testid="datasource-node-id">{dataSourceNodeId}</span>
          <span data-testid="is-running">{isRunning.toString()}</span>
          <button data-testid="process-btn" onClick={onProcess}>Process</button>
          <button data-testid="preview-btn" onClick={onPreview}>Preview</button>
          <button data-testid="back-btn" onClick={onBack}>Back</button>
        </div>
      )
    }),
  }))

  const defaultProps = {
    formRef: { current: null } as unknown as React.RefObject<{ submit: () => void }>,
    dataSourceNodeId: 'node-1',
    isRunning: false,
    onProcess: vi.fn(),
    onPreview: vi.fn(),
    onSubmit: vi.fn(),
    onBack: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render ProcessDocuments component', () => {
    render(<StepTwoContent {...defaultProps} />)
    expect(screen.getByTestId('process-documents')).toBeInTheDocument()
  })

  it('should pass dataSourceNodeId to ProcessDocuments', () => {
    render(<StepTwoContent {...defaultProps} dataSourceNodeId="custom-node" />)
    expect(screen.getByTestId('datasource-node-id')).toHaveTextContent('custom-node')
  })

  it('should pass isRunning to ProcessDocuments', () => {
    render(<StepTwoContent {...defaultProps} isRunning={true} />)
    expect(screen.getByTestId('is-running')).toHaveTextContent('true')
  })

  it('should call onProcess when process button is clicked', () => {
    const onProcess = vi.fn()
    render(<StepTwoContent {...defaultProps} onProcess={onProcess} />)

    fireEvent.click(screen.getByTestId('process-btn'))

    expect(onProcess).toHaveBeenCalled()
  })

  it('should call onBack when back button is clicked', () => {
    const onBack = vi.fn()
    render(<StepTwoContent {...defaultProps} onBack={onBack} />)

    fireEvent.click(screen.getByTestId('back-btn'))

    expect(onBack).toHaveBeenCalled()
  })
})

describe('StepThreeContent', () => {
  // Mock Processing since it has complex dependencies
  vi.mock('./processing', () => ({
    default: ({ batchId, documents }: { batchId: string, documents: unknown[] }) => (
      <div data-testid="processing">
        <span data-testid="batch-id">{batchId}</span>
        <span data-testid="documents-count">{documents.length}</span>
      </div>
    ),
  }))

  it('should render Processing component', () => {
    render(<StepThreeContent batchId="batch-123" documents={[]} />)
    expect(screen.getByTestId('processing')).toBeInTheDocument()
  })

  it('should pass batchId to Processing', () => {
    render(<StepThreeContent batchId="batch-123" documents={[]} />)
    expect(screen.getByTestId('batch-id')).toHaveTextContent('batch-123')
  })

  it('should pass documents count to Processing', () => {
    const documents = [{ id: '1' }, { id: '2' }]
    render(<StepThreeContent batchId="batch-123" documents={documents as InitialDocumentDetail[]} />)
    expect(screen.getByTestId('documents-count')).toHaveTextContent('2')
  })
})

// ==========================================
// Preview Panel Tests
// ==========================================
describe('StepOnePreview', () => {
  // Mock preview components
  vi.mock('./preview/file-preview', () => ({
    default: ({ file, hidePreview }: { file: CustomFile, hidePreview: () => void }) => (
      <div data-testid="file-preview">
        <span data-testid="file-name">{file.name}</span>
        <button data-testid="hide-preview" onClick={hidePreview}>Hide</button>
      </div>
    ),
  }))

  vi.mock('./preview/online-document-preview', () => ({
    default: ({ datasourceNodeId, currentPage, hidePreview }: {
      datasourceNodeId: string
      currentPage: NotionPage & { workspace_id: string }
      hidePreview: () => void
    }) => (
      <div data-testid="online-document-preview">
        <span data-testid="node-id">{datasourceNodeId}</span>
        <span data-testid="page-id">{currentPage.page_id}</span>
        <button data-testid="hide-preview" onClick={hidePreview}>Hide</button>
      </div>
    ),
  }))

  vi.mock('./preview/web-preview', () => ({
    default: ({ currentWebsite, hidePreview }: { currentWebsite: CrawlResultItem, hidePreview: () => void }) => (
      <div data-testid="web-preview">
        <span data-testid="url">{currentWebsite.source_url}</span>
        <button data-testid="hide-preview" onClick={hidePreview}>Hide</button>
      </div>
    ),
  }))

  const defaultProps = {
    datasource: undefined as Datasource | undefined,
    currentLocalFile: undefined as CustomFile | undefined,
    currentDocument: undefined as (NotionPage & { workspace_id: string }) | undefined,
    currentWebsite: undefined as CrawlResultItem | undefined,
    hidePreviewLocalFile: vi.fn(),
    hidePreviewOnlineDocument: vi.fn(),
    hideWebsitePreview: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not render any preview when no file is selected', () => {
    const { container } = render(<StepOnePreview {...defaultProps} />)
    expect(container.querySelector('[data-testid="file-preview"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="online-document-preview"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="web-preview"]')).not.toBeInTheDocument()
  })

  it('should render FilePreview when currentLocalFile is set', () => {
    render(
      <StepOnePreview
        {...defaultProps}
        currentLocalFile={createMockFile()}
      />,
    )
    expect(screen.getByTestId('file-preview')).toBeInTheDocument()
    expect(screen.getByTestId('file-name')).toHaveTextContent('test.txt')
  })

  it('should render OnlineDocumentPreview when currentDocument is set', () => {
    render(
      <StepOnePreview
        {...defaultProps}
        datasource={createMockDatasource()}
        currentDocument={createMockNotionPage()}
      />,
    )
    expect(screen.getByTestId('online-document-preview')).toBeInTheDocument()
  })

  it('should render WebsitePreview when currentWebsite is set', () => {
    render(
      <StepOnePreview
        {...defaultProps}
        currentWebsite={createMockCrawlResult()}
      />,
    )
    expect(screen.getByTestId('web-preview')).toBeInTheDocument()
  })

  it('should call hidePreviewLocalFile when hide button is clicked', () => {
    const hidePreviewLocalFile = vi.fn()
    render(
      <StepOnePreview
        {...defaultProps}
        currentLocalFile={createMockFile()}
        hidePreviewLocalFile={hidePreviewLocalFile}
      />,
    )

    fireEvent.click(screen.getByTestId('hide-preview'))

    expect(hidePreviewLocalFile).toHaveBeenCalled()
  })
})

describe('StepTwoPreview', () => {
  // Mock ChunkPreview
  vi.mock('./preview/chunk-preview', () => ({
    default: ({ dataSourceType, isIdle, isPending, onPreview }: {
      dataSourceType: string
      isIdle: boolean
      isPending: boolean
      onPreview: () => void
    }) => (
      <div data-testid="chunk-preview">
        <span data-testid="datasource-type">{dataSourceType}</span>
        <span data-testid="is-idle">{isIdle.toString()}</span>
        <span data-testid="is-pending">{isPending.toString()}</span>
        <button data-testid="preview-btn" onClick={onPreview}>Preview</button>
      </div>
    ),
  }))

  const defaultProps = {
    datasourceType: DatasourceType.localFile as string | undefined,
    localFileList: [] as FileItem[],
    onlineDocuments: [] as (NotionPage & { workspace_id: string })[],
    websitePages: [] as CrawlResultItem[],
    selectedOnlineDriveFileList: [] as OnlineDriveFile[],
    isIdle: true,
    isPendingPreview: false,
    estimateData: undefined,
    onPreview: vi.fn(),
    handlePreviewFileChange: vi.fn(),
    handlePreviewOnlineDocumentChange: vi.fn(),
    handlePreviewWebsitePageChange: vi.fn(),
    handlePreviewOnlineDriveFileChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render ChunkPreview component', () => {
    render(<StepTwoPreview {...defaultProps} />)
    expect(screen.getByTestId('chunk-preview')).toBeInTheDocument()
  })

  it('should pass datasourceType to ChunkPreview', () => {
    render(<StepTwoPreview {...defaultProps} datasourceType={DatasourceType.onlineDocument} />)
    expect(screen.getByTestId('datasource-type')).toHaveTextContent(DatasourceType.onlineDocument)
  })

  it('should pass isIdle to ChunkPreview', () => {
    render(<StepTwoPreview {...defaultProps} isIdle={false} />)
    expect(screen.getByTestId('is-idle')).toHaveTextContent('false')
  })

  it('should pass isPendingPreview to ChunkPreview', () => {
    render(<StepTwoPreview {...defaultProps} isPendingPreview={true} />)
    expect(screen.getByTestId('is-pending')).toHaveTextContent('true')
  })

  it('should call onPreview when preview button is clicked', () => {
    const onPreview = vi.fn()
    render(<StepTwoPreview {...defaultProps} onPreview={onPreview} />)

    fireEvent.click(screen.getByTestId('preview-btn'))

    expect(onPreview).toHaveBeenCalled()
  })
})

// ==========================================
// Edge Cases Tests
// ==========================================
describe('Edge Cases', () => {
  describe('Empty States', () => {
    it('should handle undefined datasource in useDatasourceUIState', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        datasource: undefined,
        allFileLoaded: false,
        localFileListLength: 0,
        onlineDocumentsLength: 0,
        websitePagesLength: 0,
        selectedFileIdsLength: 0,
        onlineDriveFileList: [],
        isVectorSpaceFull: false,
        enableBilling: true,
        currentWorkspacePagesLength: 0,
        fileUploadConfig: { file_size_limit: 15, batch_count_limit: 5 },
      }))

      expect(result.current.datasourceType).toBeUndefined()
      expect(result.current.nextBtnDisabled).toBe(true)
    })
  })

  describe('Boundary Conditions', () => {
    it('should handle zero file size limit', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        datasource: createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.onlineDrive,
          },
        }),
        allFileLoaded: false,
        localFileListLength: 0,
        onlineDocumentsLength: 0,
        websitePagesLength: 0,
        selectedFileIdsLength: 0,
        onlineDriveFileList: [],
        isVectorSpaceFull: false,
        enableBilling: true,
        currentWorkspacePagesLength: 0,
        fileUploadConfig: { file_size_limit: 0, batch_count_limit: 0 },
      }))

      expect(result.current.tip).toContain('datasetPipeline.addDocuments.selectOnlineDriveTip')
    })

    it('should handle very large file counts', () => {
      const { result } = renderHook(() => useDatasourceUIState({
        datasource: createMockDatasource(),
        allFileLoaded: true,
        localFileListLength: 10000,
        onlineDocumentsLength: 0,
        websitePagesLength: 0,
        selectedFileIdsLength: 0,
        onlineDriveFileList: [],
        isVectorSpaceFull: false,
        enableBilling: true,
        currentWorkspacePagesLength: 0,
        fileUploadConfig: { file_size_limit: 15, batch_count_limit: 5 },
      }))

      expect(result.current.nextBtnDisabled).toBe(false)
    })
  })

  describe('File with special characters', () => {
    it('should handle file name with special characters', () => {
      const file = createMockFile({ name: 'test<>&"\'file.txt' })
      const result = buildLocalFileDatasourceInfo(file, 'cred-1')
      expect(result.name).toBe('test<>&"\'file.txt')
    })

    it('should handle unicode file names', () => {
      const file = createMockFile({ name: '测试文件🚀.txt' })
      const result = buildLocalFileDatasourceInfo(file, 'cred-1')
      expect(result.name).toBe('测试文件🚀.txt')
    })
  })
})

// ==========================================
// Component Memoization Tests
// ==========================================
describe('Component Memoization', () => {
  it('StepOneContent should be memoized', async () => {
    const StepOneContentModule = await import('./steps/step-one-content')
    expect(StepOneContentModule.default.$$typeof).toBe(Symbol.for('react.memo'))
  })

  it('StepTwoContent should be memoized', async () => {
    const StepTwoContentModule = await import('./steps/step-two-content')
    expect(StepTwoContentModule.default.$$typeof).toBe(Symbol.for('react.memo'))
  })

  it('StepThreeContent should be memoized', async () => {
    const StepThreeContentModule = await import('./steps/step-three-content')
    expect(StepThreeContentModule.default.$$typeof).toBe(Symbol.for('react.memo'))
  })

  it('StepOnePreview should be memoized', () => {
    expect(StepOnePreview.$$typeof).toBe(Symbol.for('react.memo'))
  })

  it('StepTwoPreview should be memoized', () => {
    expect(StepTwoPreview.$$typeof).toBe(Symbol.for('react.memo'))
  })
})

// ==========================================
// Hook Callback Stability Tests
// ==========================================
describe('Hook Callback Stability', () => {
  describe('useDatasourceUIState memoization', () => {
    it('should maintain stable reference for datasourceType when dependencies unchanged', () => {
      const params = {
        datasource: createMockDatasource(),
        allFileLoaded: true,
        localFileListLength: 1,
        onlineDocumentsLength: 0,
        websitePagesLength: 0,
        selectedFileIdsLength: 0,
        onlineDriveFileList: [] as OnlineDriveFile[],
        isVectorSpaceFull: false,
        enableBilling: true,
        currentWorkspacePagesLength: 0,
        fileUploadConfig: { file_size_limit: 15, batch_count_limit: 5 },
      }

      const { result, rerender } = renderHook(() => useDatasourceUIState(params))
      const firstType = result.current.datasourceType

      rerender()

      expect(result.current.datasourceType).toBe(firstType)
    })
  })
})

// ==========================================
// Store Hooks Tests
// ==========================================
describe('Store Hooks', () => {
  describe('useLocalFile', () => {
    it('should return localFileList from store', () => {
      mockStoreState.localFileList = [createMockFileItem()]
      const { result } = renderHook(() => useLocalFile())
      expect(result.current.localFileList).toHaveLength(1)
    })

    it('should compute allFileLoaded correctly when all files have ids', () => {
      mockStoreState.localFileList = [createMockFileItem()]
      const { result } = renderHook(() => useLocalFile())
      expect(result.current.allFileLoaded).toBe(true)
    })

    it('should compute allFileLoaded as false when no files', () => {
      mockStoreState.localFileList = []
      const { result } = renderHook(() => useLocalFile())
      expect(result.current.allFileLoaded).toBe(false)
    })
  })

  describe('useOnlineDocument', () => {
    it('should return onlineDocuments from store', () => {
      mockStoreState.onlineDocuments = [createMockNotionPage()]
      const { result } = renderHook(() => useOnlineDocument())
      expect(result.current.onlineDocuments).toHaveLength(1)
    })

    it('should compute PagesMapAndSelectedPagesId correctly', () => {
      mockStoreState.documentsData = [{
        workspace_id: 'ws-1',
        pages: [{ page_id: 'page-1' }],
      }]
      const { result } = renderHook(() => useOnlineDocument())
      expect(result.current.PagesMapAndSelectedPagesId['page-1']).toBeDefined()
    })
  })

  describe('useWebsiteCrawl', () => {
    it('should return websitePages from store', () => {
      mockStoreState.websitePages = [createMockCrawlResult()]
      const { result } = renderHook(() => useWebsiteCrawl())
      expect(result.current.websitePages).toHaveLength(1)
    })
  })

  describe('useOnlineDrive', () => {
    it('should return onlineDriveFileList from store', () => {
      mockStoreState.onlineDriveFileList = [createMockOnlineDriveFile()]
      const { result } = renderHook(() => useOnlineDrive())
      expect(result.current.onlineDriveFileList).toHaveLength(1)
    })

    it('should compute selectedOnlineDriveFileList correctly', () => {
      mockStoreState.onlineDriveFileList = [
        createMockOnlineDriveFile({ id: 'file-1' }),
        createMockOnlineDriveFile({ id: 'file-2' }),
      ]
      mockStoreState.selectedFileIds = ['file-1']
      const { result } = renderHook(() => useOnlineDrive())
      expect(result.current.selectedOnlineDriveFileList).toHaveLength(1)
      expect(result.current.selectedOnlineDriveFileList[0].id).toBe('file-1')
    })
  })
})

// ==========================================
// All Datasource Types Tests
// ==========================================
describe('All Datasource Types', () => {
  const datasourceTypes = [
    { type: DatasourceType.localFile, name: 'Local File' },
    { type: DatasourceType.onlineDocument, name: 'Online Document' },
    { type: DatasourceType.websiteCrawl, name: 'Website Crawl' },
    { type: DatasourceType.onlineDrive, name: 'Online Drive' },
  ]

  describe.each(datasourceTypes)('$name datasource type', ({ type }) => {
    it(`should handle ${type} in useDatasourceUIState`, () => {
      const { result } = renderHook(() => useDatasourceUIState({
        datasource: createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: type,
          },
        }),
        allFileLoaded: type === DatasourceType.localFile,
        localFileListLength: type === DatasourceType.localFile ? 1 : 0,
        onlineDocumentsLength: type === DatasourceType.onlineDocument ? 1 : 0,
        websitePagesLength: type === DatasourceType.websiteCrawl ? 1 : 0,
        selectedFileIdsLength: type === DatasourceType.onlineDrive ? 1 : 0,
        onlineDriveFileList: type === DatasourceType.onlineDrive ? [createMockOnlineDriveFile()] : [],
        isVectorSpaceFull: false,
        enableBilling: true,
        currentWorkspacePagesLength: type === DatasourceType.onlineDocument ? 1 : 0,
        fileUploadConfig: { file_size_limit: 15, batch_count_limit: 5 },
      }))

      expect(result.current.datasourceType).toBe(type)
      expect(result.current.nextBtnDisabled).toBe(false)
    })
  })
})

// ==========================================
// useDatasourceOptions Hook Tests
// ==========================================
describe('useDatasourceOptions', () => {
  it('should return empty array when no pipeline nodes', () => {
    const { result } = renderHook(() => useDatasourceOptions([]))
    expect(result.current).toEqual([])
  })

  it('should filter and map data source nodes', () => {
    const mockNodes: Node<DataSourceNodeType>[] = [
      {
        id: 'node-1',
        type: 'data-source',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.DataSource,
          title: 'Local File Source',
          provider_type: DatasourceType.localFile,
          plugin_id: 'plugin-1',
        } as DataSourceNodeType,
      },
      {
        id: 'node-2',
        type: 'other',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.Start,
          title: 'Start Node',
        } as unknown as DataSourceNodeType,
      },
    ]

    const { result } = renderHook(() => useDatasourceOptions(mockNodes))
    expect(result.current).toHaveLength(1)
    expect(result.current[0].label).toBe('Local File Source')
    expect(result.current[0].value).toBe('node-1')
  })

  it('should return multiple options for multiple data source nodes', () => {
    const mockNodes: Node<DataSourceNodeType>[] = [
      {
        id: 'node-1',
        type: 'data-source',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.DataSource,
          title: 'Source 1',
          provider_type: DatasourceType.localFile,
          plugin_id: 'plugin-1',
        } as DataSourceNodeType,
      },
      {
        id: 'node-2',
        type: 'data-source',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.DataSource,
          title: 'Source 2',
          provider_type: DatasourceType.onlineDocument,
          plugin_id: 'plugin-2',
        } as DataSourceNodeType,
      },
    ]

    const { result } = renderHook(() => useDatasourceOptions(mockNodes))
    expect(result.current).toHaveLength(2)
  })
})

// ==========================================
// useDatasourceActions Hook Tests
// ==========================================
describe('useDatasourceActions', () => {
  const createMockDataSourceStore = () => ({
    getState: () => ({
      ...mockStoreState,
      previewLocalFileRef: { current: createMockFile() },
      previewOnlineDocumentRef: { current: createMockNotionPage() },
      previewWebsitePageRef: { current: createMockCrawlResult() },
      previewOnlineDriveFileRef: { current: createMockOnlineDriveFile() },
      currentCredentialId: 'cred-1',
      bucket: 'test-bucket',
      localFileList: [createMockFileItem()],
      onlineDocuments: [createMockNotionPage()],
      websitePages: [createMockCrawlResult()],
      selectedFileIds: ['file-1'],
      onlineDriveFileList: [createMockOnlineDriveFile({ id: 'file-1' })],
      setCurrentCredentialId: vi.fn(),
      currentNodeIdRef: { current: '' },
      setOnlineDocuments: vi.fn(),
      setSelectedFileIds: vi.fn(),
      setSelectedPagesId: vi.fn(),
    }),
  })

  const defaultParams = {
    datasource: createMockDatasource(),
    datasourceType: DatasourceType.localFile,
    pipelineId: 'pipeline-1',
    dataSourceStore: createMockDataSourceStore() as MockDataSourceStore,
    setEstimateData: vi.fn(),
    setBatchId: vi.fn(),
    setDocuments: vi.fn(),
    handleNextStep: vi.fn(),
    PagesMapAndSelectedPagesId: { 'page-1': createMockNotionPage() },
    currentWorkspacePages: [{ page_id: 'page-1' }],
    clearOnlineDocumentData: vi.fn(),
    clearWebsiteCrawlData: vi.fn(),
    clearOnlineDriveData: vi.fn(),
    setDatasource: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return initial state and callbacks', () => {
    const { result } = renderHook(() => useDatasourceActions(defaultParams))

    expect(result.current.isPreview).toBeDefined()
    expect(result.current.formRef).toBeDefined()
    expect(result.current.isIdle).toBe(true)
    expect(result.current.isPending).toBe(false)
    expect(typeof result.current.onClickProcess).toBe('function')
    expect(typeof result.current.onClickPreview).toBe('function')
    expect(typeof result.current.handleSubmit).toBe('function')
  })

  it('should set isPreview to false when onClickProcess is called', () => {
    const { result } = renderHook(() => useDatasourceActions(defaultParams))

    act(() => {
      result.current.onClickProcess()
    })

    expect(result.current.isPreview.current).toBe(false)
  })

  it('should set isPreview to true when onClickPreview is called', () => {
    const { result } = renderHook(() => useDatasourceActions(defaultParams))

    act(() => {
      result.current.onClickPreview()
    })

    expect(result.current.isPreview.current).toBe(true)
  })

  it('should call handlePreviewFileChange and trigger preview', () => {
    const { result } = renderHook(() => useDatasourceActions(defaultParams))
    const mockFile = { id: 'file-1', name: 'test.txt' } as unknown as DocumentItem

    act(() => {
      result.current.handlePreviewFileChange(mockFile)
    })

    expect(result.current.isPreview.current).toBe(true)
  })

  it('should call handlePreviewOnlineDocumentChange and trigger preview', () => {
    const { result } = renderHook(() => useDatasourceActions(defaultParams))
    const mockPage = createMockNotionPage()

    act(() => {
      result.current.handlePreviewOnlineDocumentChange(mockPage)
    })

    expect(result.current.isPreview.current).toBe(true)
  })

  it('should call handlePreviewWebsiteChange and trigger preview', () => {
    const { result } = renderHook(() => useDatasourceActions(defaultParams))
    const mockWebsite = createMockCrawlResult()

    act(() => {
      result.current.handlePreviewWebsiteChange(mockWebsite)
    })

    expect(result.current.isPreview.current).toBe(true)
  })

  it('should call handlePreviewOnlineDriveFileChange and trigger preview', () => {
    const { result } = renderHook(() => useDatasourceActions(defaultParams))
    const mockFile = createMockOnlineDriveFile()

    act(() => {
      result.current.handlePreviewOnlineDriveFileChange(mockFile)
    })

    expect(result.current.isPreview.current).toBe(true)
  })

  it('should handle select all for online document', () => {
    const params = {
      ...defaultParams,
      datasourceType: DatasourceType.onlineDocument,
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          onlineDocuments: [],
          setOnlineDocuments: vi.fn(),
          setSelectedPagesId: vi.fn(),
        }),
      } as MockDataSourceStore,
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleSelectAll()
    })

    // Verify the callback was executed (no error thrown)
    expect(true).toBe(true)
  })

  it('should handle select all for online drive', () => {
    const params = {
      ...defaultParams,
      datasourceType: DatasourceType.onlineDrive,
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          onlineDriveFileList: [createMockOnlineDriveFile({ id: 'file-1' })],
          selectedFileIds: [],
          setSelectedFileIds: vi.fn(),
        }),
      } as MockDataSourceStore,
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleSelectAll()
    })

    expect(true).toBe(true)
  })

  it('should handle switch data source', () => {
    const setDatasource = vi.fn()
    const params = {
      ...defaultParams,
      setDatasource,
    }

    const { result } = renderHook(() => useDatasourceActions(params))
    const newDatasource = createMockDatasource({ nodeId: 'node-2' })

    act(() => {
      result.current.handleSwitchDataSource(newDatasource)
    })

    expect(setDatasource).toHaveBeenCalledWith(newDatasource)
  })

  it('should handle credential change', () => {
    const { result } = renderHook(() => useDatasourceActions(defaultParams))

    act(() => {
      result.current.handleCredentialChange('new-cred-id')
    })

    // Should not throw error
    expect(true).toBe(true)
  })

  it('should clear online document data when switching datasource', () => {
    const clearOnlineDocumentData = vi.fn()
    const params = {
      ...defaultParams,
      clearOnlineDocumentData,
    }

    const { result } = renderHook(() => useDatasourceActions(params))
    const newDatasource = createMockDatasource({
      nodeData: {
        ...createMockDatasource().nodeData,
        provider_type: DatasourceType.onlineDocument,
      },
    })

    act(() => {
      result.current.handleSwitchDataSource(newDatasource)
    })

    expect(clearOnlineDocumentData).toHaveBeenCalled()
  })

  it('should clear website crawl data when switching datasource', () => {
    const clearWebsiteCrawlData = vi.fn()
    const params = {
      ...defaultParams,
      clearWebsiteCrawlData,
    }

    const { result } = renderHook(() => useDatasourceActions(params))
    const newDatasource = createMockDatasource({
      nodeData: {
        ...createMockDatasource().nodeData,
        provider_type: DatasourceType.websiteCrawl,
      },
    })

    act(() => {
      result.current.handleSwitchDataSource(newDatasource)
    })

    expect(clearWebsiteCrawlData).toHaveBeenCalled()
  })

  it('should clear online drive data when switching datasource', () => {
    const clearOnlineDriveData = vi.fn()
    const params = {
      ...defaultParams,
      clearOnlineDriveData,
    }

    const { result } = renderHook(() => useDatasourceActions(params))
    const newDatasource = createMockDatasource({
      nodeData: {
        ...createMockDatasource().nodeData,
        provider_type: DatasourceType.onlineDrive,
      },
    })

    act(() => {
      result.current.handleSwitchDataSource(newDatasource)
    })

    expect(clearOnlineDriveData).toHaveBeenCalled()
  })
})

// ==========================================
// Store Hooks - Additional Coverage Tests
// ==========================================
describe('Store Hooks - Callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock store state
    mockStoreState.localFileList = []
    mockStoreState.documentsData = []
    mockStoreState.onlineDocuments = []
    mockStoreState.websitePages = []
    mockStoreState.onlineDriveFileList = []
    mockStoreState.selectedFileIds = []
  })

  describe('useLocalFile callbacks', () => {
    it('should call hidePreviewLocalFile callback', () => {
      const { result } = renderHook(() => useLocalFile())

      act(() => {
        result.current.hidePreviewLocalFile()
      })

      expect(mockStoreState.setCurrentLocalFile).toHaveBeenCalledWith(undefined)
    })
  })

  describe('useOnlineDocument callbacks', () => {
    it('should return currentWorkspace from documentsData', () => {
      mockStoreState.documentsData = [{ workspace_id: 'ws-1', pages: [] }]
      const { result } = renderHook(() => useOnlineDocument())

      expect(result.current.currentWorkspace).toBeDefined()
      expect(result.current.currentWorkspace?.workspace_id).toBe('ws-1')
    })

    it('should call hidePreviewOnlineDocument callback', () => {
      const { result } = renderHook(() => useOnlineDocument())

      act(() => {
        result.current.hidePreviewOnlineDocument()
      })

      expect(mockStoreState.setCurrentDocument).toHaveBeenCalledWith(undefined)
    })

    it('should call clearOnlineDocumentData callback', () => {
      const { result } = renderHook(() => useOnlineDocument())

      act(() => {
        result.current.clearOnlineDocumentData()
      })

      expect(mockStoreState.setDocumentsData).toHaveBeenCalledWith([])
      expect(mockStoreState.setSearchValue).toHaveBeenCalledWith('')
      expect(mockStoreState.setOnlineDocuments).toHaveBeenCalledWith([])
      expect(mockStoreState.setCurrentDocument).toHaveBeenCalledWith(undefined)
    })
  })

  describe('useWebsiteCrawl callbacks', () => {
    it('should call hideWebsitePreview callback', () => {
      const { result } = renderHook(() => useWebsiteCrawl())

      act(() => {
        result.current.hideWebsitePreview()
      })

      expect(mockStoreState.setCurrentWebsite).toHaveBeenCalledWith(undefined)
      expect(mockStoreState.setPreviewIndex).toHaveBeenCalledWith(-1)
    })

    it('should call clearWebsiteCrawlData callback', () => {
      const { result } = renderHook(() => useWebsiteCrawl())

      act(() => {
        result.current.clearWebsiteCrawlData()
      })

      expect(mockStoreState.setStep).toHaveBeenCalled()
      expect(mockStoreState.setCrawlResult).toHaveBeenCalledWith(undefined)
      expect(mockStoreState.setCurrentWebsite).toHaveBeenCalledWith(undefined)
      expect(mockStoreState.setWebsitePages).toHaveBeenCalledWith([])
      expect(mockStoreState.setPreviewIndex).toHaveBeenCalledWith(-1)
    })
  })

  describe('useOnlineDrive callbacks', () => {
    it('should call clearOnlineDriveData callback', () => {
      const { result } = renderHook(() => useOnlineDrive())

      act(() => {
        result.current.clearOnlineDriveData()
      })

      expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([])
      expect(mockStoreState.setBucket).toHaveBeenCalledWith('')
      expect(mockStoreState.setPrefix).toHaveBeenCalledWith([])
      expect(mockStoreState.setKeywords).toHaveBeenCalledWith('')
      expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith([])
    })
  })
})

// ==========================================
// StepOneContent - All Datasource Types
// ==========================================
describe('StepOneContent - All Datasource Types', () => {
  // Mock data source components
  vi.mock('./data-source/local-file', () => ({
    default: () => <div data-testid="local-file-component">Local File</div>,
  }))

  vi.mock('./data-source/online-documents', () => ({
    default: () => <div data-testid="online-documents-component">Online Documents</div>,
  }))

  vi.mock('./data-source/website-crawl', () => ({
    default: () => <div data-testid="website-crawl-component">Website Crawl</div>,
  }))

  vi.mock('./data-source/online-drive', () => ({
    default: () => <div data-testid="online-drive-component">Online Drive</div>,
  }))

  const defaultProps = {
    datasource: undefined as Datasource | undefined,
    datasourceType: undefined as string | undefined,
    pipelineNodes: [] as Node<DataSourceNodeType>[],
    supportBatchUpload: true,
    localFileListLength: 0,
    isShowVectorSpaceFull: false,
    showSelect: false,
    totalOptions: undefined as number | undefined,
    selectedOptions: undefined as number | undefined,
    tip: '',
    nextBtnDisabled: true,
    onSelectDataSource: vi.fn(),
    onCredentialChange: vi.fn(),
    onSelectAll: vi.fn(),
    onNextStep: vi.fn(),
  }

  it('should render OnlineDocuments when datasourceType is onlineDocument', () => {
    render(
      <StepOneContent
        {...defaultProps}
        datasource={createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.onlineDocument,
          },
        })}
        datasourceType={DatasourceType.onlineDocument}
      />,
    )
    expect(screen.getByTestId('online-documents-component')).toBeInTheDocument()
  })

  it('should render WebsiteCrawl when datasourceType is websiteCrawl', () => {
    render(
      <StepOneContent
        {...defaultProps}
        datasource={createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.websiteCrawl,
          },
        })}
        datasourceType={DatasourceType.websiteCrawl}
      />,
    )
    expect(screen.getByTestId('website-crawl-component')).toBeInTheDocument()
  })

  it('should render OnlineDrive when datasourceType is onlineDrive', () => {
    render(
      <StepOneContent
        {...defaultProps}
        datasource={createMockDatasource({
          nodeData: {
            ...createMockDatasource().nodeData,
            provider_type: DatasourceType.onlineDrive,
          },
        })}
        datasourceType={DatasourceType.onlineDrive}
      />,
    )
    expect(screen.getByTestId('online-drive-component')).toBeInTheDocument()
  })

  it('should render LocalFile when datasourceType is localFile', () => {
    render(
      <StepOneContent
        {...defaultProps}
        datasource={createMockDatasource()}
        datasourceType={DatasourceType.localFile}
      />,
    )
    expect(screen.getByTestId('local-file-component')).toBeInTheDocument()
  })
})

// ==========================================
// StepTwoPreview - with localFileList
// ==========================================
describe('StepTwoPreview - File List Mapping', () => {
  it('should correctly map localFileList to localFiles', () => {
    const fileList = [
      createMockFileItem({ file: createMockFile({ id: 'f1', name: 'file1.txt' }) }),
      createMockFileItem({ file: createMockFile({ id: 'f2', name: 'file2.txt' }) }),
    ]

    render(
      <StepTwoPreview
        datasourceType={DatasourceType.localFile}
        localFileList={fileList}
        onlineDocuments={[]}
        websitePages={[]}
        selectedOnlineDriveFileList={[]}
        isIdle={true}
        isPendingPreview={false}
        estimateData={undefined}
        onPreview={vi.fn()}
        handlePreviewFileChange={vi.fn()}
        handlePreviewOnlineDocumentChange={vi.fn()}
        handlePreviewWebsitePageChange={vi.fn()}
        handlePreviewOnlineDriveFileChange={vi.fn()}
      />,
    )

    // ChunkPreview should be rendered
    expect(screen.getByTestId('chunk-preview')).toBeInTheDocument()
  })
})

// ==========================================
// useDatasourceActions - Additional Coverage
// ==========================================
describe('useDatasourceActions - Async Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunPublishedPipeline.mockReset()
  })

  const createMockDataSourceStoreForAsync = (datasourceType: string) => ({
    getState: () => ({
      previewLocalFileRef: { current: datasourceType === DatasourceType.localFile ? createMockFile() : undefined },
      previewOnlineDocumentRef: { current: datasourceType === DatasourceType.onlineDocument ? createMockNotionPage() : undefined },
      previewWebsitePageRef: { current: datasourceType === DatasourceType.websiteCrawl ? createMockCrawlResult() : undefined },
      previewOnlineDriveFileRef: { current: datasourceType === DatasourceType.onlineDrive ? createMockOnlineDriveFile() : undefined },
      currentCredentialId: 'cred-1',
      bucket: 'test-bucket',
      localFileList: [createMockFileItem()],
      onlineDocuments: [createMockNotionPage()],
      websitePages: [createMockCrawlResult()],
      selectedFileIds: ['file-1'],
      onlineDriveFileList: [createMockOnlineDriveFile({ id: 'file-1' })],
      setCurrentCredentialId: vi.fn(),
      currentNodeIdRef: { current: '' },
      setOnlineDocuments: vi.fn(),
      setSelectedFileIds: vi.fn(),
      setSelectedPagesId: vi.fn(),
    }),
  })

  it('should call handleSubmit with preview mode', () => {
    const setEstimateData = vi.fn()
    const params = {
      datasource: createMockDatasource(),
      datasourceType: DatasourceType.localFile,
      pipelineId: 'pipeline-1',
      dataSourceStore: createMockDataSourceStoreForAsync(DatasourceType.localFile) as MockDataSourceStore,
      setEstimateData,
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.onClickPreview()
      result.current.handleSubmit({ test: 'data' })
    })

    // Should have triggered preview
    expect(result.current.isPreview.current).toBe(true)
  })

  it('should call handleSubmit with process mode', () => {
    const setBatchId = vi.fn()
    const setDocuments = vi.fn()
    const handleNextStep = vi.fn()
    const params = {
      datasource: createMockDatasource(),
      datasourceType: DatasourceType.localFile,
      pipelineId: 'pipeline-1',
      dataSourceStore: createMockDataSourceStoreForAsync(DatasourceType.localFile) as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId,
      setDocuments,
      handleNextStep,
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.onClickProcess()
      result.current.handleSubmit({ test: 'data' })
    })

    // Should have triggered process
    expect(result.current.isPreview.current).toBe(false)
  })

  it('should not call API when datasource is undefined', () => {
    const params = {
      datasource: undefined,
      datasourceType: DatasourceType.localFile,
      pipelineId: 'pipeline-1',
      dataSourceStore: createMockDataSourceStoreForAsync(DatasourceType.localFile) as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleSubmit({ test: 'data' })
    })

    expect(mockRunPublishedPipeline).not.toHaveBeenCalled()
  })

  it('should not call API when pipelineId is undefined', () => {
    const params = {
      datasource: createMockDatasource(),
      datasourceType: DatasourceType.localFile,
      pipelineId: undefined,
      dataSourceStore: createMockDataSourceStoreForAsync(DatasourceType.localFile) as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleSubmit({ test: 'data' })
    })

    expect(mockRunPublishedPipeline).not.toHaveBeenCalled()
  })

  it('should build preview info for online document type', () => {
    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.onlineDocument,
        },
      }),
      datasourceType: DatasourceType.onlineDocument,
      pipelineId: 'pipeline-1',
      dataSourceStore: createMockDataSourceStoreForAsync(DatasourceType.onlineDocument) as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.onClickPreview()
      result.current.handleSubmit({ test: 'data' })
    })

    expect(result.current.isPreview.current).toBe(true)
  })

  it('should build preview info for website crawl type', () => {
    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.websiteCrawl,
        },
      }),
      datasourceType: DatasourceType.websiteCrawl,
      pipelineId: 'pipeline-1',
      dataSourceStore: createMockDataSourceStoreForAsync(DatasourceType.websiteCrawl) as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.onClickPreview()
      result.current.handleSubmit({ test: 'data' })
    })

    expect(result.current.isPreview.current).toBe(true)
  })

  it('should build preview info for online drive type', () => {
    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.onlineDrive,
        },
      }),
      datasourceType: DatasourceType.onlineDrive,
      pipelineId: 'pipeline-1',
      dataSourceStore: createMockDataSourceStoreForAsync(DatasourceType.onlineDrive) as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.onClickPreview()
      result.current.handleSubmit({ test: 'data' })
    })

    expect(result.current.isPreview.current).toBe(true)
  })

  it('should toggle select all for online document - deselect all when already selected', () => {
    const setOnlineDocuments = vi.fn()
    const setSelectedPagesId = vi.fn()
    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.onlineDocument,
        },
      }),
      datasourceType: DatasourceType.onlineDocument,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          onlineDocuments: [createMockNotionPage()],
          setOnlineDocuments,
          setSelectedPagesId,
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: { 'page-1': createMockNotionPage() },
      currentWorkspacePages: [{ page_id: 'page-1' }],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleSelectAll()
    })

    // Should deselect all since documents.length >= allIds.length
    expect(setOnlineDocuments).toHaveBeenCalledWith([])
  })

  it('should toggle select all for online drive - deselect all when already selected', () => {
    const setSelectedFileIds = vi.fn()
    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.onlineDrive,
        },
      }),
      datasourceType: DatasourceType.onlineDrive,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          onlineDriveFileList: [createMockOnlineDriveFile({ id: 'file-1' })],
          selectedFileIds: ['file-1'],
          setSelectedFileIds,
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleSelectAll()
    })

    // Should deselect all since selectedFileIds.length >= allKeys.length
    expect(setSelectedFileIds).toHaveBeenCalledWith([])
  })

  it('should clear data when credential changes with datasource', () => {
    const clearOnlineDocumentData = vi.fn()
    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.onlineDocument,
        },
      }),
      datasourceType: DatasourceType.onlineDocument,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          setCurrentCredentialId: vi.fn(),
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData,
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleCredentialChange('new-cred')
    })

    expect(clearOnlineDocumentData).toHaveBeenCalled()
  })
})

// ==========================================
// useDatasourceActions - onSuccess Callbacks
// ==========================================
describe('useDatasourceActions - API Success Callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call setEstimateData on preview success', async () => {
    const setEstimateData = vi.fn()
    const mockResponse = {
      data: { outputs: { chunks: 10, tokens: 100 } },
    }

    // Create a mock that calls onSuccess
    const mockMutateAsync = vi.fn().mockImplementation((_params, options) => {
      options?.onSuccess?.(mockResponse)
      return Promise.resolve(mockResponse)
    })

    vi.mocked(mockRunPublishedPipeline).mockImplementation(mockMutateAsync)

    const params = {
      datasource: createMockDatasource(),
      datasourceType: DatasourceType.localFile,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          previewLocalFileRef: { current: createMockFile() },
          currentCredentialId: 'cred-1',
          localFileList: [createMockFileItem()],
        }),
      } as MockDataSourceStore,
      setEstimateData,
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    await act(async () => {
      result.current.isPreview.current = true
      await result.current.handleSubmit({ test: 'data' })
    })

    expect(setEstimateData).toHaveBeenCalledWith(mockResponse.data.outputs)
  })

  it('should call setBatchId, setDocuments, handleNextStep on process success', async () => {
    const setBatchId = vi.fn()
    const setDocuments = vi.fn()
    const handleNextStep = vi.fn()
    const mockResponse = {
      batch: 'batch-123',
      documents: [{ id: 'doc-1' }],
    }

    const mockMutateAsync = vi.fn().mockImplementation((_params, options) => {
      options?.onSuccess?.(mockResponse)
      return Promise.resolve(mockResponse)
    })

    vi.mocked(mockRunPublishedPipeline).mockImplementation(mockMutateAsync)

    const params = {
      datasource: createMockDatasource(),
      datasourceType: DatasourceType.localFile,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          previewLocalFileRef: { current: createMockFile() },
          currentCredentialId: 'cred-1',
          localFileList: [createMockFileItem()],
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId,
      setDocuments,
      handleNextStep,
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    await act(async () => {
      result.current.isPreview.current = false
      await result.current.handleSubmit({ test: 'data' })
    })

    expect(setBatchId).toHaveBeenCalledWith('batch-123')
    expect(setDocuments).toHaveBeenCalledWith([{ id: 'doc-1' }])
    expect(handleNextStep).toHaveBeenCalled()
  })

  it('should handle empty batch and documents in process response', async () => {
    const setBatchId = vi.fn()
    const setDocuments = vi.fn()
    const handleNextStep = vi.fn()
    const mockResponse = {} // Empty response

    const mockMutateAsync = vi.fn().mockImplementation((_params, options) => {
      options?.onSuccess?.(mockResponse)
      return Promise.resolve(mockResponse)
    })

    vi.mocked(mockRunPublishedPipeline).mockImplementation(mockMutateAsync)

    const params = {
      datasource: createMockDatasource(),
      datasourceType: DatasourceType.localFile,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          previewLocalFileRef: { current: createMockFile() },
          currentCredentialId: 'cred-1',
          localFileList: [createMockFileItem()],
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId,
      setDocuments,
      handleNextStep,
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    await act(async () => {
      result.current.isPreview.current = false
      await result.current.handleSubmit({ test: 'data' })
    })

    expect(setBatchId).toHaveBeenCalledWith('')
    expect(setDocuments).toHaveBeenCalledWith([])
    expect(handleNextStep).toHaveBeenCalled()
  })
})

// ==========================================
// useDatasourceActions - buildProcessDatasourceInfo Coverage
// ==========================================
describe('useDatasourceActions - Process Mode for All Datasource Types', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should build process info for onlineDocument type', async () => {
    const setBatchId = vi.fn()
    const setDocuments = vi.fn()
    const handleNextStep = vi.fn()
    const mockResponse = { batch: 'batch-1', documents: [] }

    const mockMutateAsync = vi.fn().mockImplementation((_params, options) => {
      options?.onSuccess?.(mockResponse)
      return Promise.resolve(mockResponse)
    })
    vi.mocked(mockRunPublishedPipeline).mockImplementation(mockMutateAsync)

    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.onlineDocument,
        },
      }),
      datasourceType: DatasourceType.onlineDocument,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          currentCredentialId: 'cred-1',
          onlineDocuments: [createMockNotionPage()],
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId,
      setDocuments,
      handleNextStep,
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    await act(async () => {
      result.current.isPreview.current = false
      await result.current.handleSubmit({ test: 'data' })
    })

    expect(mockMutateAsync).toHaveBeenCalled()
    expect(setBatchId).toHaveBeenCalled()
  })

  it('should build process info for websiteCrawl type', async () => {
    const setBatchId = vi.fn()
    const setDocuments = vi.fn()
    const handleNextStep = vi.fn()
    const mockResponse = { batch: 'batch-1', documents: [] }

    const mockMutateAsync = vi.fn().mockImplementation((_params, options) => {
      options?.onSuccess?.(mockResponse)
      return Promise.resolve(mockResponse)
    })
    vi.mocked(mockRunPublishedPipeline).mockImplementation(mockMutateAsync)

    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.websiteCrawl,
        },
      }),
      datasourceType: DatasourceType.websiteCrawl,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          currentCredentialId: 'cred-1',
          websitePages: [createMockCrawlResult()],
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId,
      setDocuments,
      handleNextStep,
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    await act(async () => {
      result.current.isPreview.current = false
      await result.current.handleSubmit({ test: 'data' })
    })

    expect(mockMutateAsync).toHaveBeenCalled()
    expect(setBatchId).toHaveBeenCalled()
  })

  it('should build process info for onlineDrive type', async () => {
    const setBatchId = vi.fn()
    const setDocuments = vi.fn()
    const handleNextStep = vi.fn()
    const mockResponse = { batch: 'batch-1', documents: [] }

    const mockMutateAsync = vi.fn().mockImplementation((_params, options) => {
      options?.onSuccess?.(mockResponse)
      return Promise.resolve(mockResponse)
    })
    vi.mocked(mockRunPublishedPipeline).mockImplementation(mockMutateAsync)

    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.onlineDrive,
        },
      }),
      datasourceType: DatasourceType.onlineDrive,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          currentCredentialId: 'cred-1',
          bucket: 'test-bucket',
          selectedFileIds: ['file-1'],
          onlineDriveFileList: [createMockOnlineDriveFile({ id: 'file-1' })],
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId,
      setDocuments,
      handleNextStep,
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    await act(async () => {
      result.current.isPreview.current = false
      await result.current.handleSubmit({ test: 'data' })
    })

    expect(mockMutateAsync).toHaveBeenCalled()
    expect(setBatchId).toHaveBeenCalled()
  })

  it('should return early in preview mode when datasource is undefined', async () => {
    const setEstimateData = vi.fn()
    const mockMutateAsync = vi.fn()
    vi.mocked(mockRunPublishedPipeline).mockImplementation(mockMutateAsync)

    const params = {
      datasource: undefined, // undefined datasource
      datasourceType: DatasourceType.localFile,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({ ...mockStoreState }),
      } as MockDataSourceStore,
      setEstimateData,
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    await act(async () => {
      result.current.isPreview.current = true
      await result.current.handleSubmit({ test: 'data' })
    })

    // Should not call API when datasource is undefined
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(setEstimateData).not.toHaveBeenCalled()
  })

  it('should return early in preview mode when pipelineId is undefined', async () => {
    const setEstimateData = vi.fn()
    const mockMutateAsync = vi.fn()
    vi.mocked(mockRunPublishedPipeline).mockImplementation(mockMutateAsync)

    const params = {
      datasource: createMockDatasource(),
      datasourceType: DatasourceType.localFile,
      pipelineId: undefined, // undefined pipelineId
      dataSourceStore: {
        getState: () => ({ ...mockStoreState }),
      } as MockDataSourceStore,
      setEstimateData,
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    await act(async () => {
      result.current.isPreview.current = true
      await result.current.handleSubmit({ test: 'data' })
    })

    // Should not call API when pipelineId is undefined
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(setEstimateData).not.toHaveBeenCalled()
  })

  it('should skip file if not found in onlineDriveFileList', async () => {
    const setBatchId = vi.fn()
    const mockResponse = { batch: 'batch-1', documents: [] }

    const mockMutateAsync = vi.fn().mockImplementation((_params, options) => {
      options?.onSuccess?.(mockResponse)
      return Promise.resolve(mockResponse)
    })
    vi.mocked(mockRunPublishedPipeline).mockImplementation(mockMutateAsync)

    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.onlineDrive,
        },
      }),
      datasourceType: DatasourceType.onlineDrive,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          currentCredentialId: 'cred-1',
          bucket: 'test-bucket',
          selectedFileIds: ['non-existent-file'],
          onlineDriveFileList: [createMockOnlineDriveFile({ id: 'file-1' })],
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId,
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    await act(async () => {
      result.current.isPreview.current = false
      await result.current.handleSubmit({ test: 'data' })
    })

    // Should still call API but with empty datasource_info_list
    expect(mockMutateAsync).toHaveBeenCalled()
  })
})

// ==========================================
// useDatasourceActions - Edge Case Branches
// ==========================================
describe('useDatasourceActions - Edge Case Branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should handle selectAll when currentWorkspacePages is undefined', () => {
    const setOnlineDocuments = vi.fn()
    const setSelectedPagesId = vi.fn()

    const params = {
      datasource: createMockDatasource({
        nodeData: {
          ...createMockDatasource().nodeData,
          provider_type: DatasourceType.onlineDocument,
        },
      }),
      datasourceType: DatasourceType.onlineDocument,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          onlineDocuments: [],
          setOnlineDocuments,
          setSelectedPagesId,
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: undefined, // undefined currentWorkspacePages
      clearOnlineDocumentData: vi.fn(),
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleSelectAll()
    })

    // Should use empty array when currentWorkspacePages is undefined
    // Since allIds.length is 0 and onlineDocuments.length is 0, it should deselect
    expect(setOnlineDocuments).toHaveBeenCalledWith([])
  })

  it('should not clear data when datasource is undefined in handleCredentialChange', () => {
    const clearOnlineDocumentData = vi.fn()

    const params = {
      datasource: undefined, // undefined datasource
      datasourceType: DatasourceType.onlineDocument,
      pipelineId: 'pipeline-1',
      dataSourceStore: {
        getState: () => ({
          ...mockStoreState,
          setCurrentCredentialId: vi.fn(),
        }),
      } as MockDataSourceStore,
      setEstimateData: vi.fn(),
      setBatchId: vi.fn(),
      setDocuments: vi.fn(),
      handleNextStep: vi.fn(),
      PagesMapAndSelectedPagesId: {},
      currentWorkspacePages: [],
      clearOnlineDocumentData,
      clearWebsiteCrawlData: vi.fn(),
      clearOnlineDriveData: vi.fn(),
      setDatasource: vi.fn(),
    }

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleCredentialChange('new-cred')
    })

    // Should not call clearOnlineDocumentData when datasource is undefined
    expect(clearOnlineDocumentData).not.toHaveBeenCalled()
  })
})

// ==========================================
// Hooks Index Re-exports Test
// ==========================================
describe('Hooks Index Re-exports', () => {
  it('should export useAddDocumentsSteps', async () => {
    const hooksModule = await import('./hooks')
    expect(hooksModule.useAddDocumentsSteps).toBeDefined()
  })

  it('should export useDatasourceActions', async () => {
    const hooksModule = await import('./hooks')
    expect(hooksModule.useDatasourceActions).toBeDefined()
  })

  it('should export useDatasourceOptions', async () => {
    const hooksModule = await import('./hooks')
    expect(hooksModule.useDatasourceOptions).toBeDefined()
  })

  it('should export useLocalFile', async () => {
    const hooksModule = await import('./hooks')
    expect(hooksModule.useLocalFile).toBeDefined()
  })

  it('should export useOnlineDocument', async () => {
    const hooksModule = await import('./hooks')
    expect(hooksModule.useOnlineDocument).toBeDefined()
  })

  it('should export useOnlineDrive', async () => {
    const hooksModule = await import('./hooks')
    expect(hooksModule.useOnlineDrive).toBeDefined()
  })

  it('should export useWebsiteCrawl', async () => {
    const hooksModule = await import('./hooks')
    expect(hooksModule.useWebsiteCrawl).toBeDefined()
  })

  it('should export useDatasourceUIState', async () => {
    const hooksModule = await import('./hooks')
    expect(hooksModule.useDatasourceUIState).toBeDefined()
  })
})

// ==========================================
// Steps Index Re-exports Test
// ==========================================
describe('Steps Index Re-exports', () => {
  it('should export StepOneContent', async () => {
    const stepsModule = await import('./steps')
    expect(stepsModule.StepOneContent).toBeDefined()
  })

  it('should export StepTwoContent', async () => {
    const stepsModule = await import('./steps')
    expect(stepsModule.StepTwoContent).toBeDefined()
  })

  it('should export StepThreeContent', async () => {
    const stepsModule = await import('./steps')
    expect(stepsModule.StepThreeContent).toBeDefined()
  })
})
