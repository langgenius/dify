import type { ReactElement } from 'react'
import type { IBatchModalProps } from '../index'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import {
  createConsoleQueryWrapper,
  renderWithConsoleQuery,
  seedFeatures,
} from '@/test/console/query-data'
import BatchModal, { ProcessStatus } from '../index'

let annotationQuota = { size: 0, limit: 10 }

const mocks = vi.hoisted(() => ({
  annotationBatchImport: vi.fn(),
  checkAnnotationBatchImportProgress: vi.fn(),
  features: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': () => mocks.features(),
    }),
    consoleClient: {
      apps: {
        byAppId: {
          annotations: {
            batchImport: { post: mocks.annotationBatchImport },
            batchImportStatus: { byJobId: { get: mocks.checkAnnotationBatchImportProgress } },
          },
        },
      },
    },
  }
})

vi.mock('../csv-downloader', () => ({
  default: () => <div data-testid="csv-downloader-stub" />,
}))

let lastUploadedFile: File | undefined

vi.mock('@/app/components/billing/annotation-full', () => ({
  default: () => <div data-testid="annotation-full" />,
}))

const mockNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
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
const annotationBatchImportMock = mocks.annotationBatchImport
const checkAnnotationBatchImportProgressMock = mocks.checkAnnotationBatchImportProgress

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

function render(ui: ReactElement, { withFeatures = true } = {}) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: withFeatures ? { annotation_quota_limit: annotationQuota } : null,
  })
}

async function selectFile(user: ReturnType<typeof userEvent.setup>) {
  lastUploadedFile = new File(['question,answer'], 'batch.csv', { type: 'text/csv' })
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(input, lastUploadedFile)
}

describe('BatchModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    lastUploadedFile = undefined
    annotationQuota = { size: 0, limit: 10 }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports an upload failure once and leaves the CSV available for retry', async () => {
    const user = userEvent.setup()
    const { props } = renderComponent()
    annotationBatchImportMock.mockRejectedValueOnce(new Error('CSV contains duplicate questions'))
    await selectFile(user)
    await user.click(screen.getByRole('button', { name: 'appAnnotation.batchModal.run' }))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledExactlyOnceWith({
        type: 'error',
        message: 'appAnnotation.batchModal.runError: CSV contains duplicate questions',
      }),
    )
    expect(annotationBatchImportMock).toHaveBeenCalledWith({
      params: { app_id: 'app-id' },
      body: { file: lastUploadedFile },
    })
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'appAnnotation.batchModal.run' })).toBeEnabled()
  })

  it('reports a rejected CSV without polling a job', async () => {
    const user = userEvent.setup()
    renderComponent()
    annotationBatchImportMock.mockResolvedValueOnce({ error_msg: 'The CSV file is empty.' })
    await selectFile(user)
    await user.click(screen.getByRole('button', { name: 'appAnnotation.batchModal.run' }))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledExactlyOnceWith({
        type: 'error',
        message: 'appAnnotation.batchModal.runError: The CSV file is empty.',
      }),
    )
    expect(checkAnnotationBatchImportProgressMock).not.toHaveBeenCalled()
  })

  it('should disable run action and show billing hint when annotation quota is full', () => {
    annotationQuota = { size: 10, limit: 10 }

    renderComponent()

    expect(screen.getByTestId('annotation-full'))!.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'appAnnotation.batchModal.run' }))!.toBeDisabled()
  })

  it('should reset uploader state when modal closes and allow manual cancellation', async () => {
    const user = userEvent.setup()
    const { rerender, props } = renderComponent()

    await selectFile(user)
    expect(screen.getByText('batch')).toBeInTheDocument()

    rerender(<BatchModal {...props} isShow={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(<BatchModal {...props} isShow />)

    expect(screen.queryByText('batch')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'appAnnotation.batchModal.cancel' }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when close button is clicked', async () => {
    const user = userEvent.setup()
    const { props } = renderComponent()

    await user.click(screen.getByRole('button', { name: /operation\.close$/ }))

    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should submit the csv file, poll status, and notify when import completes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { props } = renderComponent()
    await selectFile(user)

    const runButton = screen.getByRole('button', { name: 'appAnnotation.batchModal.run' })
    expect(runButton).not.toBeDisabled()

    annotationBatchImportMock.mockResolvedValue({
      job_id: 'job-1',
      job_status: ProcessStatus.PROCESSING,
    })
    checkAnnotationBatchImportProgressMock
      .mockResolvedValueOnce({ job_id: 'job-1', job_status: ProcessStatus.PROCESSING })
      .mockResolvedValueOnce({ job_id: 'job-1', job_status: ProcessStatus.COMPLETED })

    await user.click(runButton)

    await waitFor(() => {
      expect(annotationBatchImportMock).toHaveBeenCalledTimes(1)
    })

    expect(annotationBatchImportMock.mock.calls[0]![0].body.file).toBe(lastUploadedFile)

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

  it('shows a failed quota load with a retry and keeps the import disabled', async () => {
    const user = userEvent.setup()
    const features = seedFeatures(createConsoleQueryWrapper().queryClient, {
      annotation_quota_limit: annotationQuota,
    })
    mocks.features.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(features)
    render(<BatchModal appId="app-id" isShow onCancel={vi.fn()} onAdded={vi.fn()} />, {
      withFeatures: false,
    })
    await selectFile(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('common.api.actionFailed')
    expect(screen.getByRole('button', { name: 'appAnnotation.batchModal.run' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'appAnnotation.batchModal.run' })).toBeEnabled()
  })
})
