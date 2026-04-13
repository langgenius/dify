import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as toastModule from '@/app/components/base/ui/toast'

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
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as string}</button>
  ),
}))

vi.mock('../screenshot', () => ({
  default: () => <div data-testid="screenshot" />,
}))

describe('Conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(toastModule.toast, 'success').mockImplementation((...args) => {
      mockToastSuccess(...args)
      return 'toast-id'
    })
    vi.spyOn(toastModule.toast, 'error').mockImplementation((...args) => {
      mockToastError(...args)
      return 'toast-id'
    })
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

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('datasetPipeline.conversion.confirm.title')).toBeInTheDocument()
  })

  it('should hide confirm modal when cancel is clicked', () => {
    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('should call convert when confirm is clicked', () => {
    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getAllByRole('button').at(-1)!)

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
    fireEvent.click(within(screen.getByRole('alertdialog')).getAllByRole('button').at(-1)!)

    expect(mockToastSuccess).toHaveBeenCalledWith('datasetPipeline.conversion.successMessage')
    expect(mockInvalidDatasetDetail).toHaveBeenCalled()
  })

  it('should handle failed conversion', async () => {
    mockConvert.mockImplementation((_id: string, opts: { onSuccess: (res: { status: string }) => void }) => {
      opts.onSuccess({ status: 'failed' })
    })

    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getAllByRole('button').at(-1)!)

    expect(mockToastError).toHaveBeenCalledWith('datasetPipeline.conversion.errorMessage')
  })

  it('should handle conversion error', async () => {
    mockConvert.mockImplementation((_id: string, opts: { onError: () => void }) => {
      opts.onError()
    })

    render(<Conversion />)

    fireEvent.click(screen.getByText('datasetPipeline.operations.convert'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getAllByRole('button').at(-1)!)

    expect(mockToastError).toHaveBeenCalledWith('datasetPipeline.conversion.errorMessage')
  })
})
