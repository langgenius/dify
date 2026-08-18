import { screen, waitFor } from '@testing-library/react'
import { usePathname, useRouter } from '@/next/navigation'
import { useDatasetDetail } from '@/service/knowledge/use-dataset'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetDetailLayout from '../layout-main'

const mockReplace = vi.fn()
let mockIsRbacEnabled = true

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: {
      rbac_enabled: mockIsRbacEnabled,
    },
  })

vi.mock('@/next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetDetail: vi.fn(),
}))

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')

  return createAccountStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
  }))
})
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
vi.mock('@/context/system-features-state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')

  return createSystemFeaturesStateModuleMock(() => ({
    datasetRbacEnabled: mockIsRbacEnabled,
  }))
})

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: undefined,
  }),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

const mockUseRouter = vi.mocked(useRouter)
const mockUsePathname = vi.mocked(usePathname)
const mockUseDatasetDetail = vi.mocked(useDatasetDetail)

describe('DatasetDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRbacEnabled = true
    mockUsePathname.mockReturnValue('/datasets/dataset-1/documents')
    mockUseRouter.mockReturnValue({
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      push: vi.fn(),
      replace: mockReplace,
      prefetch: vi.fn(),
    })
  })

  describe('Access Errors', () => {
    it.each([403, 404])(
      'should redirect to datasets page when dataset detail returns %s',
      async (status) => {
        // Arrange
        mockUseDatasetDetail.mockReturnValue({
          data: undefined,
          error: new Response(null, { status }),
          refetch: vi.fn(),
        } as unknown as ReturnType<typeof useDatasetDetail>)

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

    it('should redirect when the dataset detail error exposes status without being a Response', async () => {
      // Arrange
      mockUseDatasetDetail.mockReturnValue({
        data: undefined,
        error: { status: 403 },
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDatasetDetail>)

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
    })
  })

  describe('Rendering', () => {
    it('should render children when dataset detail is available', () => {
      // Arrange
      mockUseDatasetDetail.mockReturnValue({
        data: {
          id: 'dataset-1',
          name: 'Dataset 1',
          provider: 'vendor',
          runtime_mode: 'rag_pipeline',
          is_published: true,
        },
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDatasetDetail>)

      // Act
      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Pipeline content</div>
        </DatasetDetailLayout>,
      )

      // Assert
      expect(screen.getByText('Pipeline content')).toBeInTheDocument()
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('should render document creation route content without owning the main skip target', () => {
      // Arrange
      mockUsePathname.mockReturnValue('/datasets/dataset-1/documents/create')
      mockUseDatasetDetail.mockReturnValue({
        data: {
          id: 'dataset-1',
          name: 'Dataset 1',
          provider: 'vendor',
          runtime_mode: 'rag_pipeline',
          is_published: true,
        },
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDatasetDetail>)

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
    it('should redirect from hit testing when retrieval recall permission is missing', async () => {
      // Arrange
      mockUsePathname.mockReturnValue('/datasets/dataset-1/hitTesting')
      mockUseDatasetDetail.mockReturnValue({
        data: {
          id: 'dataset-1',
          name: 'Dataset 1',
          provider: 'external',
          runtime_mode: 'general',
          is_published: true,
          permission_keys: [],
        },
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDatasetDetail>)

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
      mockUseDatasetDetail.mockReturnValue({
        data: {
          id: 'dataset-1',
          name: 'Dataset 1',
          provider: 'vendor',
          runtime_mode: 'general',
          is_published: true,
          permission_keys: [],
        },
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDatasetDetail>)

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
      mockUseDatasetDetail.mockReturnValue({
        data: {
          id: 'dataset-1',
          name: 'Dataset 1',
          provider: 'vendor',
          runtime_mode: 'general',
          is_published: true,
          permission_keys: [DatasetACLPermission.AccessConfig],
        },
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDatasetDetail>)

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
      mockUseDatasetDetail.mockReturnValue({
        data: {
          id: 'dataset-1',
          name: 'Dataset 1',
          provider: 'vendor',
          runtime_mode: 'general',
          is_published: true,
          permission_keys: [DatasetACLPermission.AccessConfig],
        },
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDatasetDetail>)

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
