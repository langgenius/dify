import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import BatchModal, { ProcessStatus } from './index'
import { useProviderContext } from '@/context/provider-context'
import { annotationBatchImport, checkAnnotationBatchImportProgress } from '@/service/annotation'
import type { IBatchModalProps } from './index'
import Toast from '@/app/components/base/toast'

jest.mock('@/app/components/base/toast', () => ({
  __esModule: true,
  default: {
    notify: jest.fn(),
  },
}))

jest.mock('@/service/annotation', () => ({
  annotationBatchImport: jest.fn(),
  checkAnnotationBatchImportProgress: jest.fn(),
}))

jest.mock('@/context/provider-context', () => ({
  useProviderContext: jest.fn(),
}))

jest.mock('./csv-downloader', () => ({
  __esModule: true,
  default: () => <div data-testid="csv-downloader-stub" />,
}))

let lastUploadedFile: File | undefined

jest.mock('./csv-uploader', () => ({
  __esModule: true,
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

jest.mock('@/app/components/billing/annotation-full', () => ({
  __esModule: true,
  default: () => <div data-testid="annotation-full" />,
}))

const mockNotify = Toast.notify as jest.Mock
const useProviderContextMock = useProviderContext as jest.Mock
const annotationBatchImportMock = annotationBatchImport as jest.Mock
const checkAnnotationBatchImportProgressMock = checkAnnotationBatchImportProgress as jest.Mock

const renderComponent = (props: Partial<IBatchModalProps> = {}) => {
  const mergedProps: IBatchModalProps = {
    appId: 'app-id',
    isShow: true,
    onCancel: jest.fn(),
    onAdded: jest.fn(),
    ...props,
  }
  return {
    ...render(<BatchModal {...mergedProps} />),
    props: mergedProps,
  }
}

describe('BatchModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    lastUploadedFile = undefined
    useProviderContextMock.mockReturnValue({
      plan: {
        usage: { annotatedResponse: 0 },
        total: { annotatedResponse: 10 },
      },
      enableBilling: false,
    })
  })

  it('should disable run action and show billing hint when annotation quota is full', () => {
    useProviderContextMock.mockReturnValue({
      plan: {
        usage: { annotatedResponse: 10 },
        total: { annotatedResponse: 10 },
      },
      enableBilling: true,
    })

    renderComponent()

    expect(screen.getByTestId('annotation-full')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'appAnnotation.batchModal.run' })).toBeDisabled()
  })

  it('should reset uploader state when modal closes and allow manual cancellation', () => {
    const { rerender, props } = renderComponent()

    fireEvent.click(screen.getByTestId('mock-uploader'))
    expect(screen.getByTestId('selected-file')).toHaveTextContent('batch.csv')

    rerender(<BatchModal {...props} isShow={false} />)
    rerender(<BatchModal {...props} isShow />)

    expect(screen.queryByTestId('selected-file')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'appAnnotation.batchModal.cancel' }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should submit the csv file, poll status, and notify when import completes', async () => {
    jest.useFakeTimers()
    const { props } = renderComponent()
    const fileTrigger = screen.getByTestId('mock-uploader')
    fireEvent.click(fileTrigger)

    const runButton = screen.getByRole('button', { name: 'appAnnotation.batchModal.run' })
    expect(runButton).not.toBeDisabled()

    annotationBatchImportMock.mockResolvedValue({ job_id: 'job-1', job_status: ProcessStatus.PROCESSING })
    checkAnnotationBatchImportProgressMock
      .mockResolvedValueOnce({ job_id: 'job-1', job_status: ProcessStatus.PROCESSING })
      .mockResolvedValueOnce({ job_id: 'job-1', job_status: ProcessStatus.COMPLETED })

    await act(async () => {
      fireEvent.click(runButton)
    })

    await waitFor(() => {
      expect(annotationBatchImportMock).toHaveBeenCalledTimes(1)
    })

    const formData = annotationBatchImportMock.mock.calls[0][0].body as FormData
    expect(formData.get('file')).toBe(lastUploadedFile)

    await waitFor(() => {
      expect(checkAnnotationBatchImportProgressMock).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      jest.runOnlyPendingTimers()
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
    jest.useRealTimers()
  })
})
