import { screen, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithConsoleQueryWithoutUrlState,
} from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { DatasetACLPermission } from '@/utils/permission'
import CreateDocumentsPage from '../documents/create/page'
import DatasetDetailLayout from '../layout-main'

const mockReplace = vi.fn()
let mockIsRbacEnabled = true
const mockNavigation = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}))

const onUrlUpdate = vi.fn()
const renderWithConsoleQuery = createNuqsTestRenderer(
  renderWithConsoleQueryWithoutUrlState,
  () => ({ onUrlUpdate }),
)

let dataset: ReturnType<typeof createDatasetFixture> | undefined
const { loadDataset } = vi.hoisted(() => ({ loadDataset: vi.fn() }))
const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'text-embedding' } },
    }),
    { data: null },
  )
  if (dataset)
    queryClient.setQueryData(
      consoleQuery.datasets.byDatasetId.get.queryKey({
        input: { params: { dataset_id: 'dataset-1' } },
      }),
      dataset,
    )
  queryClient.setQueryData(consoleQuery.auth.plugin.datasource.defaultList.get.queryKey(), {
    result: [],
  })
  return renderWithConsoleQuery(ui, {
    queryClient,
    systemFeatures: { rbac_enabled: mockIsRbacEnabled },
  })
}

vi.mock('@/next/navigation', () => mockNavigation)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.get': loadDataset,
    }),
  }
})

vi.mock('@/app/components/datasets/create/step-one', () => ({
  default: () => <div>Create knowledge content</div>,
}))

vi.mock('@/app/components/datasets/create/step-two', () => ({
  default: () => null,
}))

vi.mock('@/app/components/datasets/create/step-three', () => ({
  default: () => null,
}))

vi.mock('@/app/components/datasets/create/top-bar', () => ({
  TopBar: () => null,
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => ({}))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

const mockUseRouter = mockNavigation.useRouter
const mockUsePathname = mockNavigation.usePathname

describe('DatasetDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadDataset.mockReset()
    dataset = undefined
    document.title = ''
    mockIsRbacEnabled = true
    mockUsePathname.mockReturnValue('/datasets/dataset-1/documents')
    mockUseRouter.mockReturnValue({
      replace: mockReplace,
    })
  })

  describe('Document title', () => {
    it.each([
      ['/datasets/dataset-1/documents', 'common.datasetMenus.documents'],
      ['/datasets/dataset-1/documents/create', 'datasetPipeline.addDocuments.title'],
      ['/datasets/dataset-1/documents/create-from-pipeline', 'datasetPipeline.addDocuments.title'],
      ['/datasets/dataset-1/pipeline', 'common.datasetMenus.pipeline'],
      ['/datasets/dataset-1/hitTesting', 'common.datasetMenus.hitTesting'],
      ['/datasets/dataset-1/evaluation', 'evaluation.title'],
      ['/datasets/dataset-1/settings', 'common.datasetMenus.settings'],
      ['/datasets/dataset-1/access-config', 'navigation.settings.resourceAccess'],
      ['/datasets/dataset-1/api', 'common.appMenus.apiAccess'],
    ])('identifies the current detail page for %s', async (pathname, pageTitle) => {
      mockUsePathname.mockReturnValue(pathname)
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: Object.values(DatasetACLPermission),
      })

      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Knowledge page content</div>
        </DatasetDetailLayout>,
      )

      await waitFor(() => {
        expect(document.title).toBe(`${pageTitle} · Dataset 1 - Dify`)
      })
    })

    it.each([
      '/datasets/dataset-1/documents/document-1',
      '/datasets/dataset-1/documents/document-1/settings',
    ])('delegates the document title for %s to the document page', (pathname) => {
      mockUsePathname.mockReturnValue(pathname)
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: Object.values(DatasetACLPermission),
      })

      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Document page content</div>
        </DatasetDetailLayout>,
      )

      expect(document.title).toBe('')
    })

    it('keeps the dataset title when the document creation route is composed', async () => {
      mockUsePathname.mockReturnValue('/datasets/dataset-1/documents/create')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: Object.values(DatasetACLPermission),
      })
      const page = await CreateDocumentsPage({
        params: Promise.resolve({ datasetId: 'dataset-1' }),
      })

      render(<DatasetDetailLayout datasetId="dataset-1">{page}</DatasetDetailLayout>)

      expect(screen.getByText('Create knowledge content')).toBeInTheDocument()
      await waitFor(() => {
        expect(document.title).toBe('datasetPipeline.addDocuments.title · Dataset 1 - Dify')
      })
    })
  })

  describe('Access Errors', () => {
    it.each([403, 404])(
      'should redirect to datasets page when dataset detail returns %s',
      async (status) => {
        // Arrange
        loadDataset.mockRejectedValue(createHttpError(new Response(null, { status })))

        // Act
        render(
          <DatasetDetailLayout datasetId="dataset-1">
            <div>Pipeline content</div>
          </DatasetDetailLayout>,
        )

        // Assert
        await waitFor(() => {
          expect(mockReplace).toHaveBeenCalledWith('/datasets')
        })
        expect(screen.queryByText('Pipeline content')).not.toBeInTheDocument()
      },
    )
  })

  describe('Rendering', () => {
    it('should render document creation route content without owning the main skip target', () => {
      // Arrange
      mockUsePathname.mockReturnValue('/datasets/dataset-1/documents/create')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'rag_pipeline',
        is_published: true,
      })

      // Act
      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Create document content</div>
        </DatasetDetailLayout>,
      )

      // Assert
      expect(screen.getByText('Create document content')).toBeInTheDocument()
      expect(screen.queryByRole('main')).not.toBeInTheDocument()
    })
  })

  describe('Permission Route Guards', () => {
    it('should render evaluation with pipeline-test permission', () => {
      mockUsePathname.mockReturnValue('/datasets/dataset-1/evaluation')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: [DatasetACLPermission.PipelineTest],
      })

      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Evaluation content</div>
        </DatasetDetailLayout>,
      )

      expect(screen.getByText('Evaluation content')).toBeInTheDocument()
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('should redirect evaluation when pipeline-test permission is missing', async () => {
      mockUsePathname.mockReturnValue('/datasets/dataset-1/evaluation')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: [],
      })

      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Evaluation content</div>
        </DatasetDetailLayout>,
      )

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/datasets/dataset-1/documents')
      })
      expect(screen.queryByText('Evaluation content')).not.toBeInTheDocument()
    })

    it('should redirect evaluation for external datasets', async () => {
      mockUsePathname.mockReturnValue('/datasets/dataset-1/evaluation')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'external',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: [DatasetACLPermission.PipelineTest],
      })

      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Evaluation content</div>
        </DatasetDetailLayout>,
      )

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/datasets/dataset-1/settings')
      })
      expect(screen.queryByText('Evaluation content')).not.toBeInTheDocument()
    })

    it('should redirect evaluation while a RAG pipeline is unpublished', async () => {
      mockUsePathname.mockReturnValue('/datasets/dataset-1/evaluation')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'rag_pipeline',
        is_published: false,
        permission_keys: [DatasetACLPermission.PipelineTest],
      })

      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Evaluation content</div>
        </DatasetDetailLayout>,
      )

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/datasets/dataset-1/pipeline')
      })
      expect(screen.queryByText('Evaluation content')).not.toBeInTheDocument()
    })

    it('should redirect from hit testing when retrieval recall permission is missing', async () => {
      // Arrange
      mockUsePathname.mockReturnValue('/datasets/dataset-1/hitTesting')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'external',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: [],
      })

      // Act
      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Hit testing content</div>
        </DatasetDetailLayout>,
      )

      // Assert
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/datasets/dataset-1/settings')
      })
      expect(screen.queryByText('Hit testing content')).not.toBeInTheDocument()
    })

    it('should redirect from access config when access config permission is missing', async () => {
      // Arrange
      mockUsePathname.mockReturnValue('/datasets/dataset-1/access-config')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: [],
      })

      // Act
      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Access config content</div>
        </DatasetDetailLayout>,
      )

      // Assert
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/datasets/dataset-1/documents')
      })
      expect(screen.queryByText('Access config content')).not.toBeInTheDocument()
    })

    it('should render access config when access config permission is granted', () => {
      // Arrange
      mockUsePathname.mockReturnValue('/datasets/dataset-1/access-config')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: [DatasetACLPermission.AccessConfig],
      })

      // Act
      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Access config content</div>
        </DatasetDetailLayout>,
      )

      // Assert
      expect(screen.getByText('Access config content')).toBeInTheDocument()
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('should redirect from access config when RBAC is disabled', async () => {
      // Arrange
      mockIsRbacEnabled = false
      mockUsePathname.mockReturnValue('/datasets/dataset-1/access-config')
      dataset = createDatasetFixture({
        id: 'dataset-1',
        name: 'Dataset 1',
        provider: 'vendor',
        runtime_mode: 'general',
        is_published: true,
        permission_keys: [DatasetACLPermission.AccessConfig],
      })

      // Act
      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Access config content</div>
        </DatasetDetailLayout>,
      )

      // Assert
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/datasets/dataset-1/documents')
      })
      expect(screen.queryByText('Access config content')).not.toBeInTheDocument()
    })
  })
})
