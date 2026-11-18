import type { ReactElement } from 'react'
import type { IBatchModalProps } from '../index'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import BatchModal, { ProcessStatus } from '../index'

let annotationQuota = { size: 0, limit: 10 }

const mocks = vi.hoisted(() => ({
  annotationBatchImport: vi.fn(),
  checkAnnotationBatchImportProgress: vi.fn(),
}))

vi.mock('@/service/annotation', () => ({
  annotationBatchImport: mocks.annotationBatchImport,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': () => zGetFeaturesResponse.parse({ annotation_quota_limit: annotationQuota }),
    }),
    consoleClient: {
      apps: {
        byAppId: {
          annotations: {
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

function render(ui: ReactElement) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { annotation_quota_limit: annotationQuota },
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
    expect(annotationBatchImportMock).toHaveBeenCalledWith('app-id', expect.any(FormData), {
      silent: true,
    })
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'appAnnotation.batchModal.run' })).toBeEnabled()
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
    const { props, queryClient } = renderComponent()
    const annotationKeys = (appId: string) => {
      const listKey = consoleQuery.apps.byAppId.annotations.get.queryKey({
        input: { params: { app_id: appId }, query: { page: 1, limit: 10 } },
      })
      const countKey = consoleQuery.apps.byAppId.annotations.count.get.queryKey({
        input: { params: { app_id: appId } },
      })
      const exportKey = consoleQuery.apps.byAppId.annotations.export.get.queryKey({
        input: { params: { app_id: appId } },
      })
      queryClient.setQueryData(listKey, { data: [], total: 0, page: 1, limit: 10, has_more: false })
      queryClient.setQueryData(countKey, { count: 0 })
      queryClient.setQueryData(exportKey, { data: [] })
      return [listKey, countKey, exportKey]
    }
    const affected = annotationKeys('app-id')
    const unrelated = annotationKeys('other-app')
    const featuresUpdatedAt = queryClient.getQueryState(
      consoleQuery.features.get.queryKey(),
    )?.dataUpdatedAt
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

    const formData = annotationBatchImportMock.mock.calls[0]![1] as FormData
    expect(formData.get('file')).toBe(lastUploadedFile)

    await waitFor(() => {
      expect(checkAnnotationBatchImportProgressMock).toHaveBeenCalledTimes(1)
    })
    for (const key of affected) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
    expect(props.onAdded).not.toHaveBeenCalled()

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
    for (const key of affected) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    for (const key of unrelated) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
    expect(
      queryClient.getQueryState(consoleQuery.features.get.queryKey())?.dataUpdatedAt,
    ).toBeGreaterThan(featuresUpdatedAt!)
    vi.useRealTimers()
  })
})
