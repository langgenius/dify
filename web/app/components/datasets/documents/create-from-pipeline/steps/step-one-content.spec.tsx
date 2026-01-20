import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasourceType } from '@/models/pipeline'
import StepOneContent from './step-one-content'

// Mock context providers and hooks (底层依赖)
vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(() => ({
    setShowPricingModal: vi.fn(),
  })),
}))

// Mock billing components that have complex provider dependencies
vi.mock('@/app/components/billing/vector-space-full', () => ({
  default: () => <div data-testid="vector-space-full">Vector Space Full</div>,
}))

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: ({ onClick }: { onClick?: () => void }) => (
    <button data-testid="upgrade-btn" onClick={onClick}>Upgrade</button>
  ),
}))

// Mock data source store
vi.mock('../data-source/store', () => ({
  useDataSourceStore: vi.fn(() => ({
    getState: () => ({
      localFileList: [],
      currentCredentialId: 'mock-credential-id',
    }),
    setState: vi.fn(),
  })),
  useDataSourceStoreWithSelector: vi.fn((selector: (state: unknown) => unknown) => {
    const mockState = {
      localFileList: [],
      onlineDocuments: [],
      websitePages: [],
      selectedOnlineDriveFileList: [],
    }
    return selector(mockState)
  }),
}))

// Mock file upload config
vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: vi.fn(() => ({
    data: {
      file_size_limit: 15 * 1024 * 1024,
      batch_count_limit: 20,
      document_file_extensions: ['.txt', '.md', '.pdf'],
    },
    isLoading: false,
  })),
}))

// Mock hooks used by data source options
vi.mock('../hooks', () => ({
  useDatasourceOptions: vi.fn(() => [
    { label: 'Local File', value: 'node-1', data: { type: 'data-source' } },
  ]),
}))

// Mock useDatasourceIcon hook to avoid complex data source list transformation
vi.mock('../data-source-options/hooks', () => ({
  useDatasourceIcon: vi.fn(() => '/icons/local-file.svg'),
}))

// Mock the entire local-file component since it has deep context dependencies
vi.mock('../data-source/local-file', () => ({
  default: ({ allowedExtensions, supportBatchUpload }: {
    allowedExtensions: string[]
    supportBatchUpload: boolean
  }) => (
    <div data-testid="local-file">
      <div>Drag and drop file here</div>
      <span data-testid="allowed-extensions">{allowedExtensions.join(',')}</span>
      <span data-testid="support-batch-upload">{String(supportBatchUpload)}</span>
    </div>
  ),
}))

// Mock online documents since it has complex OAuth/API dependencies
vi.mock('../data-source/online-documents', () => ({
  default: ({ nodeId, onCredentialChange }: {
    nodeId: string
    onCredentialChange: (credentialId: string) => void
  }) => (
    <div data-testid="online-documents">
      <span data-testid="online-doc-node-id">{nodeId}</span>
      <button data-testid="credential-change-btn" onClick={() => onCredentialChange('new-credential')}>
        Change Credential
      </button>
    </div>
  ),
}))

// Mock website crawl
vi.mock('../data-source/website-crawl', () => ({
  default: ({ nodeId, onCredentialChange }: {
    nodeId: string
    onCredentialChange: (credentialId: string) => void
  }) => (
    <div data-testid="website-crawl">
      <span data-testid="website-crawl-node-id">{nodeId}</span>
      <button data-testid="website-credential-btn" onClick={() => onCredentialChange('website-credential')}>
        Change Website Credential
      </button>
    </div>
  ),
}))

// Mock online drive
vi.mock('../data-source/online-drive', () => ({
  default: ({ nodeId, onCredentialChange }: {
    nodeId: string
    onCredentialChange: (credentialId: string) => void
  }) => (
    <div data-testid="online-drive">
      <span data-testid="online-drive-node-id">{nodeId}</span>
      <button data-testid="drive-credential-btn" onClick={() => onCredentialChange('drive-credential')}>
        Change Drive Credential
      </button>
    </div>
  ),
}))

// Mock locale context
vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(() => 'en'),
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

// Mock theme hook
vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(() => 'light'),
}))

// Mock upload service
vi.mock('@/service/base', () => ({
  upload: vi.fn().mockResolvedValue({ id: 'uploaded-file-id' }),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({ datasetId: 'mock-dataset-id' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/datasets/mock-dataset-id',
}))

// Mock pipeline service hooks
vi.mock('@/service/use-pipeline', () => ({
  useNotionWorkspaces: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useNotionPages: vi.fn(() => ({
    data: { pages: [] },
    isLoading: false,
  })),
  useDataSourceList: vi.fn(() => ({
    data: [
      {
        type: 'local_file',
        declaration: {
          identity: {
            name: 'Local File',
            icon: '/icons/local-file.svg',
          },
        },
      },
    ],
    isSuccess: true,
    isLoading: false,
  })),
  useCrawlResult: vi.fn(() => ({
    data: { data: [] },
    isLoading: false,
  })),
  useSupportedOauth: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useOnlineDriveCredentialList: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useOnlineDriveFileList: vi.fn(() => ({
    data: { data: [] },
    isLoading: false,
  })),
}))

describe('StepOneContent', () => {
  const mockDatasource: Datasource = {
    nodeId: 'test-node-id',
    nodeData: {
      type: 'data-source',
      fileExtensions: ['txt', 'pdf'],
      title: 'Test Data Source',
      desc: 'Test description',
    } as unknown as DataSourceNodeType,
  }

  const mockPipelineNodes: Node<DataSourceNodeType>[] = [
    {
      id: 'node-1',
      data: {
        type: 'data-source',
        title: 'Node 1',
        desc: 'Description 1',
      } as unknown as DataSourceNodeType,
    } as Node<DataSourceNodeType>,
    {
      id: 'node-2',
      data: {
        type: 'data-source',
        title: 'Node 2',
        desc: 'Description 2',
      } as unknown as DataSourceNodeType,
    } as Node<DataSourceNodeType>,
  ]

  const defaultProps = {
    datasource: mockDatasource,
    datasourceType: DatasourceType.localFile,
    pipelineNodes: mockPipelineNodes,
    supportBatchUpload: true,
    localFileListLength: 0,
    isShowVectorSpaceFull: false,
    showSelect: false,
    totalOptions: 10,
    selectedOptions: 5,
    tip: 'Test tip',
    nextBtnDisabled: false,
    onSelectDataSource: vi.fn(),
    onCredentialChange: vi.fn(),
    onSelectAll: vi.fn(),
    onNextStep: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<StepOneContent {...defaultProps} />)
      expect(container.querySelector('.flex.flex-col')).toBeInTheDocument()
    })

    it('should render DataSourceOptions component', () => {
      render(<StepOneContent {...defaultProps} />)
      // DataSourceOptions renders option cards
      expect(screen.getByText('Local File')).toBeInTheDocument()
    })

    it('should render Actions component with next button', () => {
      render(<StepOneContent {...defaultProps} />)
      // Actions component renders a next step button (uses i18n key)
      const nextButton = screen.getByRole('button', { name: /datasetCreation\.stepOne\.button/i })
      expect(nextButton).toBeInTheDocument()
    })
  })

  describe('Conditional Rendering - DatasourceType', () => {
    it('should render LocalFile component when datasourceType is localFile', () => {
      render(<StepOneContent {...defaultProps} datasourceType={DatasourceType.localFile} />)
      expect(screen.getByTestId('local-file')).toBeInTheDocument()
    })

    it('should render OnlineDocuments component when datasourceType is onlineDocument', () => {
      render(<StepOneContent {...defaultProps} datasourceType={DatasourceType.onlineDocument} />)
      expect(screen.getByTestId('online-documents')).toBeInTheDocument()
    })

    it('should render WebsiteCrawl component when datasourceType is websiteCrawl', () => {
      render(<StepOneContent {...defaultProps} datasourceType={DatasourceType.websiteCrawl} />)
      expect(screen.getByTestId('website-crawl')).toBeInTheDocument()
    })

    it('should render OnlineDrive component when datasourceType is onlineDrive', () => {
      render(<StepOneContent {...defaultProps} datasourceType={DatasourceType.onlineDrive} />)
      expect(screen.getByTestId('online-drive')).toBeInTheDocument()
    })

    it('should not render data source component when datasourceType is undefined', () => {
      const { container } = render(<StepOneContent {...defaultProps} datasourceType={undefined} />)
      expect(container.querySelector('.flex.flex-col')).toBeInTheDocument()
      expect(screen.queryByTestId('local-file')).not.toBeInTheDocument()
    })
  })

  describe('Conditional Rendering - VectorSpaceFull', () => {
    it('should render VectorSpaceFull when isShowVectorSpaceFull is true', () => {
      render(<StepOneContent {...defaultProps} isShowVectorSpaceFull={true} />)
      expect(screen.getByTestId('vector-space-full')).toBeInTheDocument()
    })

    it('should not render VectorSpaceFull when isShowVectorSpaceFull is false', () => {
      render(<StepOneContent {...defaultProps} isShowVectorSpaceFull={false} />)
      expect(screen.queryByTestId('vector-space-full')).not.toBeInTheDocument()
    })
  })

  describe('Conditional Rendering - UpgradeCard', () => {
    it('should render UpgradeCard when batch upload not supported and has local files', () => {
      render(
        <StepOneContent
          {...defaultProps}
          supportBatchUpload={false}
          datasourceType={DatasourceType.localFile}
          localFileListLength={3}
        />,
      )
      // UpgradeCard contains an upgrade button
      expect(screen.getByTestId('upgrade-btn')).toBeInTheDocument()
    })

    it('should not render UpgradeCard when batch upload is supported', () => {
      render(
        <StepOneContent
          {...defaultProps}
          supportBatchUpload={true}
          datasourceType={DatasourceType.localFile}
          localFileListLength={3}
        />,
      )
      // The upgrade card should not be present
      const upgradeCard = screen.queryByText(/upload multiple files/i)
      expect(upgradeCard).not.toBeInTheDocument()
    })

    it('should not render UpgradeCard when datasourceType is not localFile', () => {
      render(
        <StepOneContent
          {...defaultProps}
          supportBatchUpload={false}
          datasourceType={undefined}
          localFileListLength={3}
        />,
      )
      expect(screen.queryByTestId('upgrade-btn')).not.toBeInTheDocument()
    })

    it('should not render UpgradeCard when localFileListLength is 0', () => {
      render(
        <StepOneContent
          {...defaultProps}
          supportBatchUpload={false}
          datasourceType={DatasourceType.localFile}
          localFileListLength={0}
        />,
      )
      expect(screen.queryByTestId('upgrade-btn')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onNextStep when next button is clicked', () => {
      const onNextStep = vi.fn()
      render(<StepOneContent {...defaultProps} onNextStep={onNextStep} />)

      const nextButton = screen.getByRole('button', { name: /datasetCreation\.stepOne\.button/i })
      nextButton.click()

      expect(onNextStep).toHaveBeenCalledTimes(1)
    })

    it('should disable next button when nextBtnDisabled is true', () => {
      render(<StepOneContent {...defaultProps} nextBtnDisabled={true} />)

      const nextButton = screen.getByRole('button', { name: /datasetCreation\.stepOne\.button/i })
      expect(nextButton).toBeDisabled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined datasource when datasourceType is undefined', () => {
      const { container } = render(
        <StepOneContent {...defaultProps} datasource={undefined} datasourceType={undefined} />,
      )
      expect(container.querySelector('.flex.flex-col')).toBeInTheDocument()
    })

    it('should handle empty pipelineNodes array', () => {
      render(<StepOneContent {...defaultProps} pipelineNodes={[]} />)
      // Should still render but DataSourceOptions may show no options
      const { container } = render(<StepOneContent {...defaultProps} pipelineNodes={[]} />)
      expect(container.querySelector('.flex.flex-col')).toBeInTheDocument()
    })

    it('should handle undefined totalOptions', () => {
      render(<StepOneContent {...defaultProps} totalOptions={undefined} />)
      const nextButton = screen.getByRole('button', { name: /datasetCreation\.stepOne\.button/i })
      expect(nextButton).toBeInTheDocument()
    })

    it('should handle undefined selectedOptions', () => {
      render(<StepOneContent {...defaultProps} selectedOptions={undefined} />)
      const nextButton = screen.getByRole('button', { name: /datasetCreation\.stepOne\.button/i })
      expect(nextButton).toBeInTheDocument()
    })

    it('should handle empty tip', () => {
      render(<StepOneContent {...defaultProps} tip="" />)
      const nextButton = screen.getByRole('button', { name: /datasetCreation\.stepOne\.button/i })
      expect(nextButton).toBeInTheDocument()
    })
  })
})
