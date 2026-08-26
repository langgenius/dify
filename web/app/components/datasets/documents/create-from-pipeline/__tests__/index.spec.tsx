import { waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/client'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import CreateFromPipeline from '../index'

const mockPlan = {
  usage: { vectorSpace: 50 },
  total: { vectorSpace: 100 },
  type: 'professional',
}

const render = (ui: React.ReactElement, vectorSpaceUsageUnknown = false) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryOptions().queryKey, {
    size: mockPlan.usage.vectorSpace,
    limit: mockPlan.total.vectorSpace,
    usage_unknown: vectorSpaceUsageUnknown,
  })
  return renderWithConsoleQuery(ui, { queryClient })
}

let mockDatasetPermissionKeys = ['dataset.acl.use']
let mockAllFileLoaded = false
const mockRouterReplace = vi.fn()
const mockStepOneContent = vi.fn()

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (
    selector: (state: { plan: typeof mockPlan; enableBilling: boolean }) => unknown,
  ) => selector({ plan: mockPlan, enableBilling: true }),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['dataset.create_and_management'],
    isLoadingWorkspacePermissionKeys: false,
  }))
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['dataset.create_and_management'],
    isLoadingWorkspacePermissionKeys: false,
  }))
})

vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')

  return createSystemFeaturesStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['dataset.create_and_management'],
    isLoadingWorkspacePermissionKeys: false,
  }))
})

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: {
      dataset: {
        id: string
        pipeline_id: string
        permission_keys: string[]
      }
    }) => unknown,
  ) =>
    selector({
      dataset: {
        id: 'test-dataset-id',
        pipeline_id: 'test-pipeline-id',
        permission_keys: mockDatasetPermissionKeys,
      },
    }),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ datasetId: 'test-dataset-id' }),
  useRouter: () => ({
    push: vi.fn(),
    replace: mockRouterReplace,
    back: vi.fn(),
  }),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: { file_size_limit: 15, batch_count_limit: 5 },
  }),
}))

vi.mock('@/service/use-pipeline', () => ({
  usePublishedPipelineInfo: () => ({
    data: { graph: { nodes: [] } },
    isFetching: false,
  }),
}))

vi.mock('../data-source/store', () => ({
  useDataSourceStore: () => ({ getState: () => ({}) }),
}))

vi.mock('../data-source/store/provider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../steps', () => ({
  StepOneContent: (props: object) => {
    mockStepOneContent(props)
    return null
  },
  StepTwoContent: () => null,
  StepThreeContent: () => null,
}))

vi.mock('../hooks', () => ({
  useAddDocumentsSteps: () => ({
    steps: [],
    currentStep: 1,
    handleNextStep: vi.fn(),
    handleBackStep: vi.fn(),
  }),
  useLocalFile: () => ({
    localFileList: [],
    allFileLoaded: mockAllFileLoaded,
    currentLocalFile: undefined,
    hidePreviewLocalFile: vi.fn(),
  }),
  useOnlineDocument: () => ({
    currentWorkspace: undefined,
    onlineDocuments: [],
    currentDocument: undefined,
    PagesMapAndSelectedPagesId: {},
    hidePreviewOnlineDocument: vi.fn(),
    clearOnlineDocumentData: vi.fn(),
  }),
  useWebsiteCrawl: () => ({
    websitePages: [],
    currentWebsite: undefined,
    hideWebsitePreview: vi.fn(),
    clearWebsiteCrawlData: vi.fn(),
  }),
  useOnlineDrive: () => ({
    onlineDriveFileList: [],
    selectedFileIds: [],
    selectedOnlineDriveFileList: [],
    clearOnlineDriveData: vi.fn(),
  }),
  useDatasourceUIState: () => ({
    datasourceType: undefined,
    isShowVectorSpaceFull: false,
    nextBtnDisabled: true,
    showSelect: false,
    totalOptions: 0,
    selectedOptions: 0,
    tip: '',
  }),
  useDatasourceActions: () => ({
    isPreview: { current: false },
    formRef: { current: null },
    isIdle: true,
    isPending: false,
    onClickProcess: vi.fn(),
    onClickPreview: vi.fn(),
    handleSubmit: vi.fn(),
    handlePreviewFileChange: vi.fn(),
    handlePreviewOnlineDocumentChange: vi.fn(),
    handlePreviewWebsiteChange: vi.fn(),
    handlePreviewOnlineDriveFileChange: vi.fn(),
    handleSelectAll: vi.fn(),
    handleSwitchDataSource: vi.fn(),
    handleCredentialChange: vi.fn(),
  }),
}))

describe('CreateFromPipeline permission guard', () => {
  beforeEach(() => {
    mockRouterReplace.mockClear()
    mockStepOneContent.mockClear()
    mockDatasetPermissionKeys = ['dataset.acl.use']
    mockAllFileLoaded = false
    mockPlan.type = 'professional'
  })

  it('redirects users who cannot add documents to the dataset', async () => {
    mockDatasetPermissionKeys = ['dataset.acl.edit']

    render(<CreateFromPipeline />)

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith('/datasets/test-dataset-id/documents')
    })
  })

  it('requires sandbox users to retry when vector space usage is unknown', () => {
    mockAllFileLoaded = true
    mockPlan.type = 'sandbox'

    render(<CreateFromPipeline />, true)

    expect(mockStepOneContent).toHaveBeenCalledWith(
      expect.objectContaining({ isShowVectorSpaceUnavailable: true }),
    )
  })

  it('allows paid users to continue when vector space usage is unknown', () => {
    mockAllFileLoaded = true

    render(<CreateFromPipeline />, true)

    expect(mockStepOneContent).toHaveBeenCalledWith(
      expect.objectContaining({ isShowVectorSpaceUnavailable: false }),
    )
  })
})
