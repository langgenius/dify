import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { DatasourceType } from '@/models/pipeline'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import StepOneContent from '../step-one-content'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

const renderWithoutPricing = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: { deployment_edition: 'CLOUD' } })

// Mock context providers and hooks (底层依赖)
// Mock billing components that have complex provider dependencies
vi.mock('@/app/components/billing/vector-space-full', () => ({
  default: () => <div data-testid="vector-space-full">Vector Space Full</div>,
}))

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: ({ onClick }: { onClick?: () => void }) => (
    <button data-testid="upgrade-btn" onClick={onClick}>
      Upgrade
    </button>
  ),
}))

// Mock hooks used by data source options
vi.mock('../../hooks', () => ({
  useDatasourceOptions: vi.fn(() => [
    { label: 'Local File', value: 'node-1', data: { type: 'data-source' } },
  ]),
}))

// Mock useDatasourceIcon hook to avoid complex data source list transformation

// Source screens own their forms and remote credentials; this suite checks which screen is selected.
vi.mock('../../data-source/local-file', () => ({ default: () => <div data-testid="local-file" /> }))
vi.mock('../../data-source/online-documents', () => ({
  default: () => <div data-testid="online-documents" />,
}))
vi.mock('../../data-source/website-crawl', () => ({
  default: () => <div data-testid="website-crawl" />,
}))
vi.mock('../../data-source/online-drive', () => ({
  default: () => <div data-testid="online-drive" />,
}))

// Mock locale context
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(() => 'en'),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

// Mock theme hook
vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(() => 'light'),
}))

// Mock upload service
vi.mock('@/service/base', () => ({
  upload: vi.fn().mockResolvedValue({ id: 'uploaded-file-id' }),
  request: vi.fn(async () => Response.json([createDatasourceProvider()])),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ datasetId: 'mock-dataset-id' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/datasets/mock-dataset-id',
}))

// Mock pipeline service hooks
function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('StepOneContent', () => {
  const mockDatasource: Datasource = {
    nodeId: 'node-1',
    nodeData: {
      type: BlockEnum.DataSource,
      title: 'Documents',
      desc: '',
      provider_type: DatasourceType.localFile,
      plugin_id: 'datasource',
      provider_name: 'source',
      datasource_name: 'documents',
      datasource_label: 'Documents',
      datasource_parameters: {},
      datasource_configurations: {},
      fileExtensions: ['txt', 'pdf'],
    },
  }
  const mockPipelineNodes: Node<DataSourceNodeType>[] = [
    { id: 'node-1', data: mockDatasource.nodeData, position: { x: 0, y: 0 } },
  ]

  const defaultProps = {
    datasource: mockDatasource,
    datasourceType: DatasourceType.localFile,
    pipelineNodes: mockPipelineNodes,
    supportBatchUpload: true,
    showBatchUploadUpgrade: false,
    isShowVectorSpaceFull: false,
    isShowVectorSpaceUnavailable: false,
    isRetryingVectorSpace: false,
    showSelect: false,
    totalOptions: 10,
    selectedOptions: 5,
    tip: 'Test tip',
    nextBtnDisabled: false,
    onSelectDataSource: vi.fn(),
    onCredentialChange: vi.fn(),
    onSelectAll: vi.fn(),
    onRetryVectorSpace: vi.fn(),
    onNextStep: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
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

  describe('Conditional Rendering - VectorSpaceUnavailable', () => {
    it('should render the retry action when vector space usage is unavailable', async () => {
      const user = userEvent.setup()
      const onRetryVectorSpace = vi.fn()
      render(
        <StepOneContent
          {...defaultProps}
          isShowVectorSpaceUnavailable
          onRetryVectorSpace={onRetryVectorSpace}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

      expect(onRetryVectorSpace).toHaveBeenCalledOnce()
    })
  })

  describe('Conditional Rendering - UpgradeCard', () => {
    it('should render UpgradeCard for a Sandbox local file source', () => {
      render(
        <StepOneContent
          {...defaultProps}
          supportBatchUpload={false}
          showBatchUploadUpgrade
          datasourceType={DatasourceType.localFile}
        />,
      )
      // UpgradeCard contains an upgrade button
      expect(screen.getByTestId('upgrade-btn')).toBeInTheDocument()
    })

    it('does not infer an upgrade requirement from unavailable batch upload', () => {
      render(
        <StepOneContent
          {...defaultProps}
          supportBatchUpload={false}
          datasourceType={DatasourceType.localFile}
        />,
      )
      expect(screen.queryByTestId('upgrade-btn')).not.toBeInTheDocument()
    })

    it('should not render UpgradeCard when datasourceType is not localFile', () => {
      render(
        <StepOneContent {...defaultProps} supportBatchUpload={false} datasourceType={undefined} />,
      )
      expect(screen.queryByTestId('upgrade-btn')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onNextStep when next button is clicked', async () => {
      const user = userEvent.setup()
      const onNextStep = vi.fn()
      render(<StepOneContent {...defaultProps} onNextStep={onNextStep} />)

      const nextButton = screen.getByRole('button', { name: /datasetCreation\.stepOne\.button/i })
      await user.click(nextButton)

      expect(onNextStep).toHaveBeenCalledTimes(1)
    })

    it('should disable next button when nextBtnDisabled is true', () => {
      render(<StepOneContent {...defaultProps} nextBtnDisabled={true} />)

      const nextButton = screen.getByRole('button', { name: /datasetCreation\.stepOne\.button/i })
      expect(nextButton).toBeDisabled()
    })
  })
})
