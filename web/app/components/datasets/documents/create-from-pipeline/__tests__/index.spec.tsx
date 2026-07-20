import { render, waitFor } from '@testing-library/react'
import CreateFromPipeline from '../index'

let mockDatasetPermissionKeys = ['dataset.acl.use']
const mockRouterReplace = vi.fn()
const mockPlan = {
  usage: { vectorSpace: 50 },
  total: { vectorSpace: 100 },
  type: 'professional',
}

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (
    selector: (state: { plan: typeof mockPlan; enableBilling: boolean }) => unknown,
  ) => selector({ plan: mockPlan, enableBilling: true }),
}))

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')
  return createDatasetAccessAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['dataset.create_and_management'],
    isLoadingWorkspacePermissionKeys: false,
  }))
})

vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')
  return createDatasetAccessAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['dataset.create_and_management'],
    isLoadingWorkspacePermissionKeys: false,
  }))
})

vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')
  return createDatasetAccessAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['dataset.create_and_management'],
    isLoadingWorkspacePermissionKeys: false,
  }))
})

vi.mock('@/context/version-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')
  return createDatasetAccessAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['dataset.create_and_management'],
    isLoadingWorkspacePermissionKeys: false,
  }))
})

vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')
  return createDatasetAccessAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['dataset.create_and_management'],
    isLoadingWorkspacePermissionKeys: false,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createDatasetAccessJotaiMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessJotaiMock(importOriginal)
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
  useRouter: () => ({
    push: vi.fn(),
    replace: mockRouterReplace,
    back: vi.fn(),
  }),
}))

vi.mock('@/service/use-billing', () => ({
  useCurrentPlanVectorSpace: () => ({
    data: { size: 50, limit: 100 },
    isFetching: false,
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

vi.mock('../hooks', () => ({
  useAddDocumentsSteps: () => ({
    steps: [],
    currentStep: 1,
    handleNextStep: vi.fn(),
    handleBackStep: vi.fn(),
  }),
  useLocalFile: () => ({
    localFileList: [],
    allFileLoaded: false,
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
    mockDatasetPermissionKeys = ['dataset.acl.use']
  })

  it('redirects users who cannot add documents to the dataset', async () => {
    mockDatasetPermissionKeys = ['dataset.acl.edit']

    render(<CreateFromPipeline />)

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith('/datasets/test-dataset-id/documents')
    })
  })
})
