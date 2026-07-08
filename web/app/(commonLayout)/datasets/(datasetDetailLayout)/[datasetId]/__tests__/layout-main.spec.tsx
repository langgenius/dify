import { screen, waitFor } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { usePathname, useRouter } from '@/next/navigation'
import { useDatasetDetail } from '@/service/knowledge/use-dataset'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetDetailLayout from '../layout-main'

const mockReplace = vi.fn()
let mockIsRbacEnabled = true

const render = (ui: Parameters<typeof renderWithSystemFeatures>[0]) => renderWithSystemFeatures(ui, {
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

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceDatasetOperator: false,
    isLoadingCurrentWorkspace: false,
    isLoadingWorkspacePermissionKeys: false,
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
  }),
  useSelector: (selector: (state: {
    isCurrentWorkspaceDatasetOperator: boolean
    isLoadingCurrentWorkspace: boolean
    isLoadingWorkspacePermissionKeys: boolean
    userProfile: { id: string }
    workspacePermissionKeys: string[]
  }) => unknown) => selector({
    isCurrentWorkspaceDatasetOperator: false,
    isLoadingCurrentWorkspace: false,
    isLoadingWorkspacePermissionKeys: false,
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
  }),
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
  }), () => ({
    isRbacEnabled: mockIsRbacEnabled,
  }))
})

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: undefined,
  }),
}))

vi.mock('jotai', async (importOriginal) => {
  const { createDatasetAccessJotaiMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessJotaiMock(importOriginal)
})

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
    it.each([403, 404])('should redirect to datasets page when dataset detail returns %s', async (status) => {
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
    })

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

    it('should apply the dataset surface outside pipeline pages', () => {
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
          <div>Documents content</div>
        </DatasetDetailLayout>,
      )

      // Assert
      expect(screen.getByText('Documents content').parentElement).toHaveClass('rounded-lg')
    })

    it('should keep pipeline pages unframed', () => {
      // Arrange
      mockUsePathname.mockReturnValue('/datasets/dataset-1/pipeline')
      mockUseDatasetDetail.mockReturnValue({
        data: {
          id: 'dataset-1',
          name: 'Dataset 1',
          provider: 'vendor',
          runtime_mode: 'rag_pipeline',
          is_published: false,
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
      expect(screen.getByText('Pipeline content').parentElement).not.toHaveClass('rounded-lg')
    })

    it('should preserve the column flex context for full-height pipeline content', () => {
      // Arrange
      mockUsePathname.mockReturnValue('/datasets/dataset-1/pipeline')
      mockUseDatasetDetail.mockReturnValue({
        data: {
          id: 'dataset-1',
          name: 'Dataset 1',
          provider: 'vendor',
          runtime_mode: 'rag_pipeline',
          is_published: false,
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
      const contentSurface = screen.getByText('Pipeline content').parentElement
      const datasetDetailContent = contentSurface?.parentElement
      const datasetDetailRoot = datasetDetailContent?.parentElement

      expect(datasetDetailRoot).toHaveClass('flex-col')
    })

    it('should keep create-from-pipeline pages unframed', () => {
      // Arrange
      mockUsePathname.mockReturnValue('/datasets/dataset-1/documents/create-from-pipeline')
      mockUseDatasetDetail.mockReturnValue({
        data: {
          id: 'dataset-1',
          name: 'Dataset 1',
          provider: 'vendor',
          runtime_mode: 'rag_pipeline',
          is_published: false,
        },
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDatasetDetail>)

      // Act
      render(
        <DatasetDetailLayout datasetId="dataset-1">
          <div>Create from pipeline content</div>
        </DatasetDetailLayout>,
      )

      // Assert
      expect(screen.getByText('Create from pipeline content').parentElement).not.toHaveClass('rounded-lg')
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
