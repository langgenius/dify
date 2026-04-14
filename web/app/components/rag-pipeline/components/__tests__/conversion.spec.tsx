import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Conversion from '../conversion'

const mockConvert = vi.fn()
const mockInvalidDatasetDetail = vi.fn()
vi.mock('@/next/navigation', () => ({
  useParams: () => ({ datasetId: 'ds-123' }),
}))

vi.mock('@/service/use-pipeline', () => ({
  useConvertDatasetToPipeline: () => ({
    mutateAsync: mockConvert,
    isPending: false,
  }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  datasetDetailQueryKeyPrefix: ['dataset-detail'],
}))

vi.mock('@/service/use-base', () => ({
  useInvalid: () => mockInvalidDatasetDetail,
}))

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

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: mockToast,
}))

vi.mock('@/app/components/base/ui/button', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as string}</button>
  ),
}))

vi.mock('../screenshot', () => ({
  default: () => <div data-testid="screenshot" />,
}))

describe('Conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    expect(mockConvert).toHaveBeenCalledWith('ds-123', expect.objectContaining({
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    }))
  })

  it('should handle successful conversion', async () => {
    mockConvert.mockImplementation((_id: string, opts: { onSuccess: (res: { status: string }) => void }) => {
      opts.onSuccess({ status: 'success' })
    })

    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockToast.success).toHaveBeenCalledWith('datasetPipeline.conversion.successMessage')
    expect(mockInvalidDatasetDetail).toHaveBeenCalled()
  })

  it('should handle failed conversion', async () => {
    mockConvert.mockImplementation((_id: string, opts: { onSuccess: (res: { status: string }) => void }) => {
      opts.onSuccess({ status: 'failed' })
    })

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
