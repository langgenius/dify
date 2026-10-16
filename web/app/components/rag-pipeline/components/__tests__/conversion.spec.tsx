import { QueryClient } from '@tanstack/react-query'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import Conversion from '../conversion'

const mockConvert = vi.fn()
const datasetDetailKey = consoleQuery.datasets.byDatasetId.get.queryKey({
  input: { params: { dataset_id: 'ds-123' } },
})
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ datasetId: 'ds-123' }),
}))

let mockDatasetDetailState = {
  dataset: {
    permission_keys: ['dataset.acl.edit'],
    maintainer: 'maintainer-id',
  },
}
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: typeof mockDatasetDetailState) => unknown,
  ) => selector(mockDatasetDetailState),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'rag.pipelines.transform.datasets.byDatasetId.post': () => ({
      mutateAsync: mockConvert,
      isPending: false,
    }),
  })
})

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

vi.mock('../screenshot', () => ({
  default: () => <div data-testid="screenshot" />,
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('Conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    mockDatasetDetailState = {
      dataset: {
        permission_keys: ['dataset.acl.edit'],
        maintainer: 'maintainer-id',
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render conversion title and description', () => {
    render(<Conversion />)

    expect(screen.getByText('datasetPipeline.conversion.title')).toBeInTheDocument()
    expect(screen.getByText('datasetPipeline.conversion.descriptionChunk1')).toBeInTheDocument()
    expect(screen.getByText('datasetPipeline.conversion.descriptionChunk2')).toBeInTheDocument()
  })

  it('should render convert button', () => {
    render(<Conversion />)

    expect(screen.getByText('datasetPipeline.operations.convert')).toBeInTheDocument()
  })

  it('should disable convert button when dataset lacks edit ACL', () => {
    mockDatasetDetailState = {
      dataset: {
        permission_keys: ['dataset.acl.readonly'],
        maintainer: 'maintainer-id',
      },
    }

    render(<Conversion />)

    const convertButton = screen.getByRole('button', { name: 'datasetPipeline.operations.convert' })
    expect(convertButton).toBeDisabled()

    fireEvent.click(convertButton)

    expect(screen.queryByText('datasetPipeline.conversion.confirm.title')).not.toBeInTheDocument()
    expect(mockConvert).not.toHaveBeenCalled()
  })

  it('should render warning text', () => {
    render(<Conversion />)

    expect(screen.getByText('datasetPipeline.conversion.warning')).toBeInTheDocument()
  })

  it('should render screenshot component', () => {
    render(<Conversion />)

    expect(screen.getByTestId('screenshot')).toBeInTheDocument()
  })

  it('should show confirm modal when convert button clicked', () => {
    render(<Conversion />)

    expect(screen.queryByText('datasetPipeline.conversion.confirm.title')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))

    expect(screen.getByText('datasetPipeline.conversion.confirm.title')).toBeInTheDocument()
  })

  it('should hide confirm modal when cancel is clicked', () => {
    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    expect(screen.getByText('datasetPipeline.conversion.confirm.title')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    return waitFor(() => {
      expect(screen.queryByText('datasetPipeline.conversion.confirm.title')).not.toBeInTheDocument()
    })
  })

  it('should call convert when confirm is clicked', () => {
    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockConvert).toHaveBeenCalledWith(
      { params: { dataset_id: 'ds-123' } },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    )
  })

  it('should handle successful conversion', async () => {
    mockConvert.mockImplementation(
      (_id: string, opts: { onSuccess: (res: { status: string }) => void }) => {
        opts.onSuccess({ status: 'success' })
      },
    )

    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockToast.success).toHaveBeenCalledWith('datasetPipeline.conversion.successMessage')
    expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
      queryKey: datasetDetailKey,
    })
  })

  it('should handle failed conversion', async () => {
    mockConvert.mockImplementation(
      (_id: string, opts: { onSuccess: (res: { status: string }) => void }) => {
        opts.onSuccess({ status: 'failed' })
      },
    )

    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockToast.error).toHaveBeenCalledWith('datasetPipeline.conversion.errorMessage')
  })

  it('should handle conversion error', async () => {
    mockConvert.mockImplementation((_id: string, opts: { onError: () => void }) => {
      opts.onError()
    })

    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockToast.error).toHaveBeenCalledWith('datasetPipeline.conversion.errorMessage')
  })
})
