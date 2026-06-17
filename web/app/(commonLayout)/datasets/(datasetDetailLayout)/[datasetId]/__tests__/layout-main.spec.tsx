import { render, screen, waitFor } from '@testing-library/react'
import { usePathname, useRouter } from '@/next/navigation'
import { useDatasetDetail } from '@/service/knowledge/use-dataset'
import DatasetDetailLayout from '../layout-main'

const mockReplace = vi.fn()

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
  }),
}))

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
  })
})
