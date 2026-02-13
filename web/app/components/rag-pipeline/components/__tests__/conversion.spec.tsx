import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Conversion from '../conversion'

const mockConvert = vi.fn()
const mockInvalidDatasetDetail = vi.fn()
vi.mock('next/navigation', () => ({
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

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as string}</button>
  ),
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({
    isShow,
    onConfirm,
    onCancel,
    title,
  }: {
    isShow: boolean
    onConfirm: () => void
    onCancel: () => void
    title: string
  }) =>
    isShow
      ? (
          <div data-testid="confirm-modal">
            <span>{title}</span>
            <button data-testid="confirm-btn" onClick={onConfirm}>Confirm</button>
            <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
          </div>
        )
      : null,
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

    expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))

    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    expect(screen.getByText('datasetPipeline.conversion.confirm.title')).toBeInTheDocument()
  })

  it('should hide confirm modal when cancel is clicked', () => {
    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('cancel-btn'))
    expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
  })

  it('should call convert when confirm is clicked', () => {
    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(screen.getByTestId('confirm-btn'))

    expect(mockConvert).toHaveBeenCalledWith('ds-123', expect.objectContaining({
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    }))
  })

  it('should handle successful conversion', async () => {
    const Toast = await import('@/app/components/base/toast')
    mockConvert.mockImplementation((_id: string, opts: { onSuccess: (res: { status: string }) => void }) => {
      opts.onSuccess({ status: 'success' })
    })

    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(screen.getByTestId('confirm-btn'))

    expect(Toast.default.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
    }))
    expect(mockInvalidDatasetDetail).toHaveBeenCalled()
  })

  it('should handle failed conversion', async () => {
    const Toast = await import('@/app/components/base/toast')
    mockConvert.mockImplementation((_id: string, opts: { onSuccess: (res: { status: string }) => void }) => {
      opts.onSuccess({ status: 'failed' })
    })

    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(screen.getByTestId('confirm-btn'))

    expect(Toast.default.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
    }))
  })

  it('should handle conversion error', async () => {
    const Toast = await import('@/app/components/base/toast')
    mockConvert.mockImplementation((_id: string, opts: { onError: () => void }) => {
      opts.onError()
    })

    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(screen.getByTestId('confirm-btn'))

    expect(Toast.default.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
    }))
  })
})
