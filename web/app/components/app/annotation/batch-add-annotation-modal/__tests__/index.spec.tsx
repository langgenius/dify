import type { ReactElement } from 'react'
import type { Mock } from 'vite-plus/test'
import type { IBatchModalProps } from '../index'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { annotationBatchImport, checkAnnotationBatchImportProgress } from '@/service/annotation'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import BatchModal, { ProcessStatus } from '../index'

let annotationQuota = { size: 0, limit: 10 }

vi.mock('@/service/annotation', () => ({
  annotationBatchImport: vi.fn(),
  checkAnnotationBatchImportProgress: vi.fn(),
}))

vi.mock('../csv-downloader', () => ({
  default: () => <div data-testid="csv-downloader-stub" />,
}))

let lastUploadedFile: File | undefined

vi.mock('../csv-uploader', () => ({
  default: ({ file, updateFile }: { file?: File; updateFile: (file?: File) => void }) => (
    <div>
      <button
        data-testid="mock-uploader"
        onClick={() => {
          lastUploadedFile = new File(['question,answer'], 'batch.csv', { type: 'text/csv' })
          updateFile(lastUploadedFile)
        }}
      >
        upload
      </button>
      {file && <span data-testid="selected-file">{file.name}</span>}
    </div>
  ),
}))

vi.mock('@/app/components/billing/annotation-full', () => ({
  default: () => <div data-testid="annotation-full" />,
}))

const mockNotify = vi.fn()
vi.mock('@langgenius/dify-ui/toast', () => ({
  default: {
    notify: (args: unknown) => mockNotify(args),
  },
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))
const annotationBatchImportMock = annotationBatchImport as Mock
const checkAnnotationBatchImportProgressMock = checkAnnotationBatchImportProgress as Mock

const renderComponent = (props: Partial<IBatchModalProps> = {}) => {
  const mergedProps: IBatchModalProps = {
    appId: 'app-id',
    isShow: true,
    onCancel: vi.fn(),
    onAdded: vi.fn(),
    ...props,
  }
  return {
    ...render(<BatchModal {...mergedProps} />),
    props: mergedProps,
  }
}

function render(ui: ReactElement) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { annotation_quota_limit: annotationQuota },
  })
}

describe('BatchModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastUploadedFile = undefined
    annotationQuota = { size: 0, limit: 10 }
  })

  it('should disable run action and show billing hint when annotation quota is full', () => {
    annotationQuota = { size: 10, limit: 10 }

    renderComponent()

    expect(screen.getByTestId('annotation-full'))!.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'appAnnotation.batchModal.run' }))!.toBeDisabled()
  })

  it('should reset uploader state when modal closes and allow manual cancellation', () => {
    const { rerender, props } = renderComponent()

    fireEvent.click(screen.getByTestId('mock-uploader'))
    expect(screen.getByTestId('selected-file'))!.toHaveTextContent('batch.csv')

    rerender(<BatchModal {...props} isShow={false} />)
    rerender(<BatchModal {...props} isShow />)

    expect(screen.queryByTestId('selected-file')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'appAnnotation.batchModal.cancel' }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when close button is clicked', () => {
    const { props } = renderComponent()

    fireEvent.click(screen.getByRole('button', { name: /operation\.close$/ }))

    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should submit the csv file, poll status, and notify when import completes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props } = renderComponent()
    const fileTrigger = screen.getByTestId('mock-uploader')
    fireEvent.click(fileTrigger)

    const runButton = screen.getByRole('button', { name: 'appAnnotation.batchModal.run' })
    expect(runButton).not.toBeDisabled()

    annotationBatchImportMock.mockResolvedValue({
      job_id: 'job-1',
      job_status: ProcessStatus.PROCESSING,
    })
    checkAnnotationBatchImportProgressMock
      .mockResolvedValueOnce({ job_id: 'job-1', job_status: ProcessStatus.PROCESSING })
      .mockResolvedValueOnce({ job_id: 'job-1', job_status: ProcessStatus.COMPLETED })

    await act(async () => {
      fireEvent.click(runButton)
    })

    await waitFor(() => {
      expect(annotationBatchImportMock).toHaveBeenCalledTimes(1)
    })

    const formData = annotationBatchImportMock.mock.calls[0]![0].body as FormData
    expect(formData.get('file')).toBe(lastUploadedFile)

    await waitFor(() => {
      expect(checkAnnotationBatchImportProgressMock).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      vi.runOnlyPendingTimers()
    })

    await waitFor(() => {
      expect(checkAnnotationBatchImportProgressMock).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'appAnnotation.batchModal.completed',
      })
      expect(props.onAdded).toHaveBeenCalledTimes(1)
      expect(props.onCancel).toHaveBeenCalledTimes(1)
    })
    vi.useRealTimers()
  })
})
