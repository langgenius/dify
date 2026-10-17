import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.transform.datasets.byDatasetId.post': (input) => mockConvert(input),
    }),
  }
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
    mockConvert.mockReset().mockResolvedValue({ status: 'success' })
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

  it('should disable convert button when dataset lacks edit ACL', async () => {
    mockDatasetDetailState = {
      dataset: {
        permission_keys: ['dataset.acl.readonly'],
        maintainer: 'maintainer-id',
      },
    }

    render(<Conversion />)

    const convertButton = screen.getByRole('button', { name: 'datasetPipeline.operations.convert' })
    expect(convertButton).toBeDisabled()

    await userEvent.setup().click(convertButton)

    expect(screen.queryByText('datasetPipeline.conversion.confirm.title')).not.toBeInTheDocument()
    expect(mockConvert).not.toHaveBeenCalled()
  })

  it('should hide confirm modal when cancel is clicked', async () => {
    render(<Conversion />)

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'datasetPipeline.operations.convert' }))
    expect(screen.getByText('datasetPipeline.conversion.confirm.title')).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(mockConvert).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByText('datasetPipeline.conversion.confirm.title')).not.toBeInTheDocument()
    })
  })

  it('should handle successful conversion', async () => {
    mockConvert.mockResolvedValue({ status: 'success' })

    render(<Conversion />)

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'datasetPipeline.operations.convert' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith('datasetPipeline.conversion.successMessage'),
    )
    expect(mockConvert).toHaveBeenCalledExactlyOnceWith({ params: { dataset_id: 'ds-123' } })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
      queryKey: datasetDetailKey,
    })
  })

  it('should handle failed conversion', async () => {
    mockConvert.mockResolvedValue({ status: 'failed' })

    render(<Conversion />)

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'datasetPipeline.operations.convert' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('datasetPipeline.conversion.errorMessage'),
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(QueryClient.prototype.invalidateQueries).not.toHaveBeenCalled()
  })

  it('should handle conversion error', async () => {
    mockConvert.mockRejectedValue(new Error('Request failed'))

    render(<Conversion />)

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'datasetPipeline.operations.convert' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('datasetPipeline.conversion.errorMessage'),
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(QueryClient.prototype.invalidateQueries).not.toHaveBeenCalled()
  })
})
