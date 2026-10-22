import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type {
  GetWorkflowRunArchivesResponse,
  WorkflowRunArchiveDeletionTaskResponse,
  WorkflowRunArchiveDownloadTaskResponse,
} from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithoutPricing,
} from '@/test/console/query-data'
import WorkflowLogArchivesPage from '../index'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())
const archiveRequests = vi.hoisted(() => ({
  list: vi.fn(),
  delete: vi.fn(),
  prepareDownload: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: readonly string[], input: unknown) => {
      switch (path.join('.')) {
        case 'workflowRunArchives.get':
          return archiveRequests.list(input)
        case 'workflowRunArchives.byYear.byMonth.delete':
          return archiveRequests.delete(input)
        case 'workflowRunArchives.downloads.post':
          return archiveRequests.prepareDownload(input)
        case 'workflowRunArchives.downloads.byDownloadId.get':
          return archiveRequests.download(input)
        default:
          throw new Error(`Unexpected console request: ${path.join('.')}`)
      }
    },
  },
}))

const archiveMonth: GetWorkflowRunArchivesResponse['months'][number] = {
  year: 2025,
  month: 3,
  workflow_run_count: 125,
  row_count: 1125,
  archive_bytes: 1048576,
  bundle_count: 2,
  latest_archived_at: '2025-03-03T00:00:00Z',
  download_task: null,
  deletion_status: null,
}

const archiveData: GetWorkflowRunArchivesResponse = {
  summary: {
    archived_month_count: 1,
    workflow_run_count: 125,
    archive_bytes: 1048576,
    latest_archived_at: '2025-03-03T00:00:00Z',
  },
  months: [archiveMonth],
}

const downloadTask: WorkflowRunArchiveDownloadTaskResponse = {
  download_id: 'archive-download',
  status: 'pending',
  error: null,
  year: 2025,
  month: 3,
  archive_bytes: 1048576,
  bundle_count: 2,
  created_at: '2025-03-03T00:00:00Z',
  updated_at: '2025-03-03T00:00:00Z',
  expires_at: '2025-03-04T00:00:00Z',
}

let plan: CloudPlan = 'professional'

function renderPage(
  data: GetWorkflowRunArchivesResponse | null = archiveData,
  queryClient = createConsoleQueryClient(),
  role: GetWorkspacesCurrentSummaryResponse['role'] = 'owner',
) {
  if (data) queryClient.setQueryData(consoleQuery.workflowRunArchives.get.queryKey(), data)

  return render(<WorkflowLogArchivesPage />, {
    queryClient,
    currentWorkspace: { role },
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { billing: { subscription: { plan } } },
  })
}

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('WorkflowLogArchivesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    archiveRequests.list.mockImplementation(() => new Promise(() => {}))
    archiveRequests.delete.mockResolvedValue({
      year: 2025,
      month: 3,
      status: 'pending',
      error: null,
    })
    archiveRequests.prepareDownload.mockImplementation(() => new Promise(() => {}))
    archiveRequests.download.mockImplementation(() => new Promise(() => {}))
    plan = 'professional'
  })

  describe('Delete monthly archives', () => {
    it('lets admins prepare downloads without offering archive deletion', async () => {
      const user = userEvent.setup()
      renderPage(archiveData, undefined, 'admin')

      expect(screen.getByRole('row', { name: /2025-03/ })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'common.operation.delete 2025-03' }),
      ).not.toBeInTheDocument()
      await user.click(
        screen.getByRole('button', { name: 'appLog.archives.action.prepareDownload 2025-03' }),
      )

      expect(archiveRequests.prepareDownload).toHaveBeenCalledWith({
        body: { year: 2025, month: 3 },
      })
      expect(archiveRequests.delete).not.toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it.each(['admin', 'editor', 'dataset_operator', 'normal'] as const)(
      'does not offer deletion retry to a workspace %s',
      (role) => {
        renderPage(
          { ...archiveData, months: [{ ...archiveMonth, deletion_status: 'failed' }] },
          undefined,
          role,
        )

        expect(
          screen.queryByRole('button', { name: 'appLog.archives.delete.retry 2025-03' }),
        ).not.toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent('appLog.archives.delete.failed')
        expect(archiveRequests.delete).not.toHaveBeenCalled()
      },
    )

    it('cancels confirmation without deleting any archived data', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: 'common.operation.delete 2025-03' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveAccessibleName('appLog.archives.delete.title:{"month":"2025-03"}')
      expect(dialog).toHaveAccessibleDescription('appLog.archives.delete.description')
      expect(archiveRequests.delete).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(archiveRequests.delete).not.toHaveBeenCalled()
      expect(screen.getByRole('row', { name: /2025-03/ })).toBeInTheDocument()
    })

    it('submits the selected month once and blocks downloads while deletion is being accepted', async () => {
      const user = userEvent.setup()
      let resolveDelete!: (data: WorkflowRunArchiveDeletionTaskResponse) => void
      archiveRequests.delete.mockImplementation(
        () =>
          new Promise<WorkflowRunArchiveDeletionTaskResponse>((resolve) => {
            resolveDelete = resolve
          }),
      )
      renderPage({ ...archiveData, months: [{ ...archiveMonth, year: 2026, month: 8 }] })
      const download = screen.getByRole('button', {
        name: 'appLog.archives.action.prepareDownload 2026-08',
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.delete 2026-08' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.dblClick(
        within(dialog).getByRole('button', { name: 'appLog.archives.delete.confirm' }),
      )

      expect(archiveRequests.delete).toHaveBeenCalledTimes(1)
      expect(archiveRequests.delete).toHaveBeenCalledWith({ params: { year: 2026, month: 8 } })
      expect(
        within(dialog).getByRole('button', { name: 'appLog.archives.delete.deleting' }),
      ).toHaveAttribute('aria-disabled', 'true')
      expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
      expect(download).toHaveAttribute('aria-disabled', 'true')

      await act(async () => resolveDelete({ year: 2026, month: 8, status: 'pending', error: null }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(
        screen.getByRole('button', { name: 'appLog.archives.delete.deleting 2026-08' }),
      ).toHaveAttribute('aria-disabled', 'true')
      expect(
        screen.getByRole('button', { name: 'appLog.archives.action.prepareDownload 2026-08' }),
      ).toHaveAttribute('aria-disabled', 'true')
      expect(archiveRequests.list).toHaveBeenCalled()
    })

    it.each(['pending', 'processing'] as const)(
      'blocks download and duplicate deletion for a %s month',
      async (status) => {
        const user = userEvent.setup()
        renderPage({ ...archiveData, months: [{ ...archiveMonth, deletion_status: status }] })

        const download = screen.getByRole('button', {
          name: 'appLog.archives.action.prepareDownload 2025-03',
        })
        const deletion = screen.getByRole('button', {
          name: 'appLog.archives.delete.deleting 2025-03',
        })
        expect(download).toHaveAttribute('aria-disabled', 'true')
        expect(deletion).toHaveAttribute('aria-disabled', 'true')
        await user.click(download)
        await user.click(deletion)
        expect(archiveRequests.prepareDownload).not.toHaveBeenCalled()
        expect(archiveRequests.delete).not.toHaveBeenCalled()
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      },
    )

    it('keeps a rejected deletion open with an error and allows retry', async () => {
      const user = userEvent.setup()
      archiveRequests.delete.mockRejectedValueOnce(new Error('Storage unavailable'))
      renderPage()

      await user.click(screen.getByRole('button', { name: 'common.operation.delete 2025-03' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(
        within(dialog).getByRole('button', { name: 'appLog.archives.delete.confirm' }),
      )

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'appLog.archives.delete.requestFailed',
      )
      expect(dialog).toBeInTheDocument()
      await user.click(
        within(dialog).getByRole('button', { name: 'appLog.archives.delete.confirm' }),
      )
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(archiveRequests.delete).toHaveBeenCalledTimes(2)
    })

    it('offers confirmed retry for an incomplete deletion while downloads remain blocked', async () => {
      const user = userEvent.setup()
      renderPage({ ...archiveData, months: [{ ...archiveMonth, deletion_status: 'failed' }] })

      expect(screen.getByRole('alert')).toHaveTextContent('appLog.archives.delete.failed')
      expect(
        screen.getByRole('button', { name: 'appLog.archives.action.prepareDownload 2025-03' }),
      ).toHaveAttribute('aria-disabled', 'true')
      await user.click(screen.getByRole('button', { name: 'appLog.archives.delete.retry 2025-03' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(archiveRequests.delete).not.toHaveBeenCalled()
      await user.click(
        within(dialog).getByRole('button', { name: 'appLog.archives.delete.confirm' }),
      )

      await waitFor(() =>
        expect(archiveRequests.delete).toHaveBeenCalledWith({ params: { year: 2025, month: 3 } }),
      )
    })

    it('refreshes persisted failure status after a deletion request fails', async () => {
      const user = userEvent.setup()
      archiveRequests.delete.mockRejectedValue(new Error('Queue unavailable'))
      archiveRequests.list.mockResolvedValue({
        ...archiveData,
        months: [{ ...archiveMonth, deletion_status: 'failed' }],
      })
      renderPage()

      await user.click(screen.getByRole('button', { name: 'common.operation.delete 2025-03' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(
        within(dialog).getByRole('button', { name: 'appLog.archives.delete.confirm' }),
      )
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'appLog.archives.delete.requestFailed',
      )
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))

      expect(
        await screen.findByRole('button', { name: 'appLog.archives.delete.retry 2025-03' }),
      ).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'appLog.archives.action.prepareDownload 2025-03' }),
      ).toHaveAttribute('aria-disabled', 'true')
    })

    it('keeps confirmation open when both deletion and the following list refresh fail', async () => {
      const user = userEvent.setup()
      archiveRequests.delete.mockRejectedValue(new Error('Network unavailable'))
      archiveRequests.list.mockRejectedValue(new Error('Network unavailable'))
      renderPage()

      await user.click(screen.getByRole('button', { name: 'common.operation.delete 2025-03' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(
        within(dialog).getByRole('button', { name: 'appLog.archives.delete.confirm' }),
      )
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'appLog.archives.delete.requestFailed',
      )
      await waitFor(() => expect(archiveRequests.list).toHaveBeenCalled())
      expect(dialog).toBeInTheDocument()
      await user.click(
        within(dialog).getByRole('button', { name: 'appLog.archives.delete.confirm' }),
      )
      await waitFor(() => expect(archiveRequests.delete).toHaveBeenCalledTimes(2))
    })

    it('refreshes the month list and summary after an accepted deletion finishes', async () => {
      const user = userEvent.setup()
      archiveRequests.list.mockResolvedValue({
        months: [],
        summary: {
          archived_month_count: 0,
          workflow_run_count: 0,
          archive_bytes: 0,
          latest_archived_at: null,
        },
      })
      renderPage()

      await user.click(screen.getByRole('button', { name: 'common.operation.delete 2025-03' }))
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'appLog.archives.delete.confirm',
        }),
      )

      expect(await screen.findByText('appLog.archives.empty.title')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('appLog.archives.empty.title')
      expect(screen.queryByRole('row', { name: /2025-03/ })).not.toBeInTheDocument()
      const runCount = screen.getByText('appLog.archives.summary.runs').parentElement
      expect(runCount).toHaveTextContent('0')
      const size = screen.getByText('appLog.archives.summary.size').parentElement
      expect(size).toHaveTextContent('0 B')
    })

    it('polls deleting months until they disappear and then stops polling', async () => {
      vi.useFakeTimers()
      try {
        archiveRequests.list
          .mockResolvedValueOnce({
            ...archiveData,
            months: [{ ...archiveMonth, deletion_status: 'processing' }],
          })
          .mockResolvedValue({
            months: [],
            summary: {
              archived_month_count: 0,
              workflow_run_count: 0,
              archive_bytes: 0,
              latest_archived_at: null,
            },
          })
        renderPage({ ...archiveData, months: [{ ...archiveMonth, deletion_status: 'pending' }] })

        await act(async () => vi.advanceTimersByTimeAsync(3001))
        expect(archiveRequests.list).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('row', { name: /2025-03/ })).toBeInTheDocument()

        await act(async () => vi.advanceTimersByTimeAsync(3001))
        expect(archiveRequests.list).toHaveBeenCalledTimes(2)
        expect(screen.getByText('appLog.archives.empty.title')).toBeInTheDocument()

        await act(async () => vi.advanceTimersByTimeAsync(3000))
        expect(archiveRequests.list).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it.each(['pending', 'processing'] as const)(
      'keeps a long-running %s deletion disabled and polling without offering retry',
      async (status) => {
        const user = userEvent.setup()
        vi.useFakeTimers()
        try {
          const deletingArchiveData = {
            ...archiveData,
            months: [{ ...archiveMonth, deletion_status: status }],
          }
          archiveRequests.list.mockResolvedValue(deletingArchiveData)
          renderPage(deletingArchiveData)

          await act(async () => vi.advanceTimersByTimeAsync(300_000))
          const pollCount = archiveRequests.list.mock.calls.length

          await act(async () => vi.advanceTimersByTimeAsync(3001))
          expect(archiveRequests.list.mock.calls.length).toBeGreaterThan(pollCount)
          const deletion = screen.getByRole('button', {
            name: 'appLog.archives.delete.deleting 2025-03',
          })
          const download = screen.getByRole('button', {
            name: 'appLog.archives.action.prepareDownload 2025-03',
          })
          expect(deletion).toHaveAttribute('aria-disabled', 'true')
          expect(download).toHaveAttribute('aria-disabled', 'true')
          expect(
            screen.queryByRole('button', {
              name: 'appLog.archives.delete.retry 2025-03',
            }),
          ).not.toBeInTheDocument()
          expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        } finally {
          vi.useRealTimers()
        }

        await user.click(
          screen.getByRole('button', {
            name: 'appLog.archives.delete.deleting 2025-03',
          }),
        )
        await user.click(
          screen.getByRole('button', {
            name: 'appLog.archives.action.prepareDownload 2025-03',
          }),
        )
        expect(archiveRequests.delete).not.toHaveBeenCalled()
        expect(archiveRequests.prepareDownload).not.toHaveBeenCalled()
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      },
    )

    it('offers retry only after the server reports that an active deletion failed', async () => {
      vi.useFakeTimers()
      try {
        renderPage({ ...archiveData, months: [{ ...archiveMonth, deletion_status: 'processing' }] })
        expect(
          screen.getByRole('button', { name: 'appLog.archives.delete.deleting 2025-03' }),
        ).toHaveAttribute('aria-disabled', 'true')

        archiveRequests.list.mockResolvedValue({
          ...archiveData,
          months: [{ ...archiveMonth, deletion_status: 'failed' }],
        })
        await act(async () => vi.advanceTimersByTimeAsync(3001))
        expect(screen.getByRole('alert')).toHaveTextContent('appLog.archives.delete.failed')
        expect(
          screen.getByRole('button', { name: 'appLog.archives.delete.retry 2025-03' }),
        ).not.toHaveAttribute('aria-disabled', 'true')
        expect(archiveRequests.delete).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('removes a month immediately when deletion is already completed', async () => {
      const user = userEvent.setup()
      archiveRequests.delete.mockResolvedValue({
        year: 2025,
        month: 3,
        status: 'completed',
        error: null,
      })
      renderPage()

      await user.click(screen.getByRole('button', { name: 'common.operation.delete 2025-03' }))
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'appLog.archives.delete.confirm',
        }),
      )

      expect(await screen.findByText('appLog.archives.empty.title')).toBeInTheDocument()
      expect(screen.queryByRole('row', { name: /2025-03/ })).not.toBeInTheDocument()
      expect(screen.getByText('appLog.archives.summary.months').parentElement).toHaveTextContent(
        '0',
      )
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('Download status announcements', () => {
    it.each(['ready', 'failed'] as const)(
      'reports a newer %s result from the archive list instead of stale polling data',
      async (status) => {
        archiveRequests.download.mockResolvedValue({ ...downloadTask, status: 'processing' })
        const data = {
          ...archiveData,
          months: [
            { ...archiveMonth, download_task: downloadTask },
            { ...archiveMonth, month: 2 },
          ],
        }
        const { queryClient } = renderPage(data)
        const row = screen.getByRole('row', { name: /2025-03/ })
        const announcement = within(row).getByRole('status')
        await waitFor(() => expect(archiveRequests.download).toHaveBeenCalled())
        expect(announcement).toBeEmptyDOMElement()
        archiveRequests.list.mockResolvedValue({
          ...data,
          months: [
            {
              ...archiveMonth,
              download_task: { ...downloadTask, status, updated_at: '2025-03-03T00:00:00.500000Z' },
            },
            { ...archiveMonth, month: 2 },
          ],
        })

        await act(async () =>
          queryClient.refetchQueries({
            queryKey: consoleQuery.workflowRunArchives.get.queryKey(),
          }),
        )

        expect(
          await within(row).findByRole('button', {
            name:
              status === 'ready'
                ? 'common.operation.download 2025-03'
                : 'common.operation.retry 2025-03',
          }),
        ).toBeEnabled()
        expect(announcement).toHaveTextContent(`2025-03: appLog.archives.downloadHint.${status}`)
      },
    )

    it.each([
      { status: 'ready', error: null, hint: 'appLog.archives.downloadHint.ready' },
      {
        status: 'failed',
        error: 'Storage unavailable',
        hint: 'appLog.archives.downloadHint.failedWithReason:{"reason":"Storage unavailable"}',
      },
      { status: 'failed', error: '  ', hint: 'appLog.archives.downloadHint.failed' },
    ] as const)(
      'reports a background download becoming $status with month context',
      async ({ status, error, hint }) => {
        vi.useFakeTimers()
        try {
          archiveRequests.download
            .mockResolvedValueOnce({ ...downloadTask, status: 'processing' })
            .mockResolvedValue({ ...downloadTask, status, error })
          renderPage({ ...archiveData, months: [{ ...archiveMonth, download_task: downloadTask }] })
          const row = screen.getByRole('row', { name: /2025-03/ })
          const announcement = within(row).getByRole('status')
          expect(announcement).toBeEmptyDOMElement()
          const deletion = within(row).getByRole('button', {
            name: 'common.operation.delete 2025-03',
          })
          act(() => deletion.focus())
          expect(deletion).toHaveFocus()

          await act(async () => vi.advanceTimersByTimeAsync(3001))

          expect(announcement).toHaveTextContent(`2025-03: ${hint}`)
          expect(announcement).toHaveAttribute('aria-atomic', 'true')
          expect(deletion).toHaveFocus()
          const pollCount = archiveRequests.download.mock.calls.length
          await act(async () => vi.advanceTimersByTimeAsync(6000))
          expect(archiveRequests.download).toHaveBeenCalledTimes(pollCount)
          expect(announcement).toHaveTextContent(`2025-03: ${hint}`)
        } finally {
          vi.useRealTimers()
        }
      },
    )

    it.each(['ready', 'failed'] as const)(
      'does not announce an initially %s download as a new result',
      (status) => {
        renderPage({
          ...archiveData,
          months: [{ ...archiveMonth, download_task: { ...downloadTask, status } }],
        })

        const row = screen.getByRole('row', { name: /2025-03/ })
        expect(within(row).getByRole('status')).toBeEmptyDOMElement()
        expect(archiveRequests.download).not.toHaveBeenCalled()
      },
    )

    it.each([
      { status: 'ready', error: null, notification: 'appLog.archives.action.downloadReady' },
      { status: 'failed', error: null, notification: 'appLog.archives.downloadHint.failed' },
      {
        status: 'failed',
        error: 'Storage unavailable',
        notification:
          'appLog.archives.downloadHint.failedWithReason:{"reason":"Storage unavailable"}',
      },
    ] as const)(
      'reports an immediately $status task once through the existing notification ($error)',
      async ({ status, error: failureReason, notification }) => {
        const user = userEvent.setup()
        const success = vi.spyOn(toast, 'success')
        const error = vi.spyOn(toast, 'error')
        archiveRequests.prepareDownload.mockResolvedValue({
          ...downloadTask,
          status,
          error: failureReason,
        })
        renderPage()

        await user.click(
          screen.getByRole('button', {
            name: 'appLog.archives.action.prepareDownload 2025-03',
          }),
        )

        const row = screen.getByRole('row', { name: /2025-03/ })
        expect(within(row).getByRole('status')).toBeEmptyDOMElement()
        if (status === 'ready') {
          expect(success).toHaveBeenCalledExactlyOnceWith(notification)
          expect(error).not.toHaveBeenCalled()
        } else {
          expect(error).toHaveBeenCalledExactlyOnceWith(notification)
          expect(success).not.toHaveBeenCalled()
        }
      },
    )

    it('clears a failed result when retry reuses the download ID before announcing the new result', async () => {
      const user = userEvent.setup()
      archiveRequests.download.mockResolvedValue({ ...downloadTask, status: 'failed' })
      const { queryClient } = renderPage({
        ...archiveData,
        months: [{ ...archiveMonth, download_task: downloadTask }],
      })
      const retry = await screen.findByRole('button', { name: 'common.operation.retry 2025-03' })
      const row = screen.getByRole('row', { name: /2025-03/ })
      const announcement = within(row).getByRole('status')
      expect(announcement).toHaveTextContent('2025-03: appLog.archives.downloadHint.failed')

      archiveRequests.prepareDownload.mockResolvedValue(downloadTask)
      archiveRequests.download.mockResolvedValue({ ...downloadTask, status: 'ready' })
      await user.click(retry)

      expect(
        within(row).getByRole('button', {
          name: 'appLog.archives.action.preparing 2025-03',
        }),
      ).toHaveAttribute('aria-disabled', 'true')
      expect(announcement).toBeEmptyDOMElement()
      await act(async () =>
        queryClient.refetchQueries({
          queryKey: consoleQuery.workflowRunArchives.downloads.byDownloadId.get.queryKey({
            input: { params: { download_id: downloadTask.download_id } },
          }),
        }),
      )
      expect(
        await within(row).findByRole('button', { name: 'common.operation.download 2025-03' }),
      ).toBeEnabled()
      expect(announcement).toHaveTextContent('2025-03: appLog.archives.downloadHint.ready')
      expect(archiveRequests.prepareDownload).toHaveBeenCalledExactlyOnceWith({
        body: { year: 2025, month: 3 },
      })
    })
  })

  describe('Archive table states', () => {
    it('announces an asynchronous empty result in an already mounted status region', async () => {
      let resolveArchives!: (data: GetWorkflowRunArchivesResponse) => void
      archiveRequests.list.mockImplementation(
        () =>
          new Promise<GetWorkflowRunArchivesResponse>((resolve) => {
            resolveArchives = resolve
          }),
      )
      renderPage(null)
      const announcement = screen.getByRole('status')
      expect(announcement).toBeEmptyDOMElement()
      await waitFor(() => expect(archiveRequests.list).toHaveBeenCalled())

      await act(async () =>
        resolveArchives({
          months: [],
          summary: {
            archived_month_count: 0,
            workflow_run_count: 0,
            archive_bytes: 0,
            latest_archived_at: null,
          },
        }),
      )

      await waitFor(() => expect(announcement).toHaveTextContent('appLog.archives.empty.title'))
      expect(announcement).toHaveTextContent('appLog.archives.empty.description')
      expect(announcement).toHaveAttribute('aria-atomic', 'true')
      expect(screen.getByRole('status')).toBe(announcement)
    })

    it('should hide loading rows from assistive technology until archives arrive', async () => {
      const queryClient = createConsoleQueryClient()
      let resolveArchives!: (data: GetWorkflowRunArchivesResponse) => void
      const response = new Promise<GetWorkflowRunArchivesResponse>((resolve) => {
        resolveArchives = resolve
      })
      const request = queryClient.query({
        queryKey: consoleQuery.workflowRunArchives.get.queryKey(),
        queryFn: () => response,
      })

      renderPage(null, queryClient)

      const table = screen.getByRole('table')
      expect(within(table).getAllByRole('row')).toHaveLength(1)
      expect(within(table).getAllByRole('row', { hidden: true }).length).toBeGreaterThan(1)
      expect(within(table).queryByText('appLog.archives.empty.title')).not.toBeInTheDocument()

      await act(async () => {
        resolveArchives(archiveData)
        await request
      })

      expect(await within(table).findByRole('row', { name: /2025-03/ })).toBeInTheDocument()
      expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(2)
    })

    it('presents an archive request error outside the scrolling table', async () => {
      const queryClient = createConsoleQueryClient()
      const queryKey = consoleQuery.workflowRunArchives.get.queryKey()
      queryClient.setQueryDefaults(queryKey, { retryOnMount: false })
      await queryClient
        .query({
          queryKey,
          queryFn: () => Promise.reject(new Error('Archives unavailable')),
        })
        .catch(() => undefined)

      renderPage(null, queryClient)

      const table = screen.getByRole('table')
      expect(screen.getByText('appLog.archives.error.title')).toBeInTheDocument()
      expect(screen.getByText('appLog.archives.error.description')).toBeInTheDocument()
      expect(within(table).queryByText('appLog.archives.error.title')).not.toBeInTheDocument()
      expect(screen.queryByText('appLog.archives.empty.title')).not.toBeInTheDocument()
      expect(within(table).queryByRole('button')).not.toBeInTheDocument()
    })

    it('presents an empty archive message outside the scrolling table', () => {
      renderPage({
        months: [],
        summary: {
          archived_month_count: 0,
          workflow_run_count: 0,
          archive_bytes: 0,
          latest_archived_at: null,
        },
      })

      const table = screen.getByRole('table')
      expect(screen.getByText('appLog.archives.empty.title')).toBeInTheDocument()
      expect(screen.getByText('appLog.archives.empty.description')).toBeInTheDocument()
      expect(within(table).queryByText('appLog.archives.empty.title')).not.toBeInTheDocument()
      expect(screen.queryByText('appLog.archives.error.title')).not.toBeInTheDocument()
      expect(within(table).queryByRole('button')).not.toBeInTheDocument()
    })

    it('should reveal remaining archive months when the load-more region enters view', () => {
      let intersect: (isIntersecting: boolean) => void = () => {}
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: IntersectionObserverCallback) {
            intersect = (isIntersecting) =>
              callback(
                [{ isIntersecting } as IntersectionObserverEntry],
                this as unknown as IntersectionObserver,
              )
          }

          observe() {}
          disconnect() {}
        },
      )
      const months = Array.from({ length: 21 }, (_, index) => ({
        ...archiveMonth,
        year: 2025 + Math.floor(index / 12),
        month: (index % 12) + 1,
      }))
      renderPage({
        months,
        summary: {
          ...archiveData.summary,
          archived_month_count: months.length,
          workflow_run_count: months.length * 125,
          archive_bytes: months.length * 1048576,
        },
      })

      const table = screen.getByRole('table')
      expect(within(table).getAllByRole('row')).toHaveLength(21)
      expect(within(table).queryByRole('row', { name: /2026-09/ })).not.toBeInTheDocument()

      act(() => intersect(false))
      expect(within(table).queryByRole('row', { name: /2026-09/ })).not.toBeInTheDocument()

      act(() => intersect(true))
      expect(within(table).getByRole('row', { name: /2026-09/ })).toBeInTheDocument()
      expect(within(table).getAllByRole('row')).toHaveLength(22)
      expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(22)
    })
  })

  describe('Plan access', () => {
    it('restricts sandbox archive access and opens pricing from upgrade guidance', async () => {
      const user = userEvent.setup()
      plan = 'sandbox'
      renderPage()

      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(archiveRequests.list).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'billing.upgradeBtn.encourageShort' }))

      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })

    it('describes the failed download when its retry button receives keyboard focus', async () => {
      const user = userEvent.setup()
      renderPage({
        ...archiveData,
        months: [
          {
            ...archiveMonth,
            download_task: {
              download_id: 'failed-export',
              status: 'failed',
              error: 'Storage unavailable',
              year: 2025,
              month: 3,
              archive_bytes: 1048576,
              bundle_count: 2,
              created_at: '2025-03-03T00:00:00Z',
              updated_at: '2025-03-03T00:00:00Z',
              expires_at: '2025-03-04T00:00:00Z',
            },
          },
        ],
      })

      const retry = screen.getByRole('button', { name: 'common.operation.retry 2025-03' })
      expect(retry).toBeEnabled()
      await user.tab()
      expect(retry).toHaveFocus()
      const tooltip = await screen.findByRole('tooltip')
      const failureHint =
        'appLog.archives.downloadHint.failedWithReason:{"reason":"Storage unavailable"}'
      expect(tooltip).toHaveTextContent(failureHint)
      expect(retry).toHaveAccessibleDescription(failureHint)
      expect(archiveRequests.prepareDownload).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('button', { name: 'common.operation.learnMore: 2025-03' }),
      ).not.toBeInTheDocument()
      await user.click(retry)
      expect(archiveRequests.prepareDownload).toHaveBeenCalledWith({
        body: { year: 2025, month: 3 },
      })
    })

    it('should show archive content for paid workspaces', () => {
      plan = 'professional'

      renderPage()

      expect(screen.queryByText('appLog.archives.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.getByText('2025-03')).toBeInTheDocument()
      const table = screen.getByRole('table')
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual([
        'appLog.archives.table.month',
        'appLog.archives.table.runs',
        'appLog.archives.table.size',
        'appLog.archives.table.action',
      ])
      const row = within(table).getByRole('row', { name: /2025-03/ })
      expect(within(row).getByRole('cell', { name: '125' })).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: 'appLog.archives.action.prepareDownload 2025-03',
        }),
      ).toBeInTheDocument()
    })
  })
})
