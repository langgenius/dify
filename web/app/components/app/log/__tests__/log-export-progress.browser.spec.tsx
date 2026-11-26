import type { ConversationLogExportStatusResponse } from '@dify/contracts/api/console/apps/types.gen'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createDeferred } from '@/test/deferred'
import { conversation, observeDownloads, openExport, taskId } from './log-export-fixture'

// boundary: Use the English progress and count copy while retaining semantic keys for controls.
vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: copy } = await import('@/i18n/locales/en-US/app-log.json')
  const mock = createReactI18nextMock({
    'export.emailNotifyWhenFinished': copy['export.emailNotifyWhenFinished'],
    'export.previewConversationCount': copy['export.previewConversationCount_other'],
    'export.previewRowCount': copy['export.previewRowCount_other'],
    'export.progressRows': copy['export.progressRows_other'],
  })
  return {
    ...original,
    ...mock,
    useTranslation: (...args: Parameters<typeof mock.useTranslation>) => ({
      ...mock.useTranslation(...args),
      ready: true,
    }),
  }
})

// boundary: Supply the docs URL without mounting the application locale provider.
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test${path}`,
}))

const progressDialog = page.getByRole('dialog', { name: 'appLog.export.progressTitle' })
const progressBar = progressDialog.getByRole('progressbar', { name: 'appLog.export.progressTitle' })
const progressClose = progressDialog.getByRole('button', { name: 'common.operation.close' }).last()
const progressDownload = progressDialog.getByRole('button', { name: 'common.operation.download' })
const cancelExport = progressDialog.getByRole('button', { name: 'appLog.export.cancel' })
const canceledToast = page.getByRole('dialog', { name: 'appLog.export.canceled' })
const emailButton = progressDialog.getByRole('button', { name: /email/i })
const emailWhenFinishedCheckbox = progressDialog.getByRole('checkbox', {
  name: 'Email me the download link when finished',
  exact: true,
})

async function renderNotifications() {
  onTestFinished(() => toast.dismiss())
  await render(<AppToaster timeout={0} />)
}

it('can reopen and cancel a queued export, then submit another one', async () => {
  await renderNotifications()
  const { trigger, dialog, lastExport, cancelRequests, statusTaskIds } = await openExport(
    false,
    'chat',
    { getTaskStatus: () => ({ status: 'pending' }) },
  )
  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })

  await trigger.click()
  await submit.click()
  await expect.element(progressDialog.getByText('appLog.export.progressQueued')).toBeVisible()
  await progressClose.click()

  await trigger.click()
  await expect
    .element(lastExport.getByRole('status'))
    .toHaveTextContent('appLog.export.progressQueued')
  await lastExport.getByRole('button', { name: 'appLog.export.viewProgress' }).click()
  await cancelExport.click()
  await expect.element(progressDialog).not.toBeInTheDocument()
  await expect.element(canceledToast).toBeVisible()
  await expect.element(canceledToast).toHaveAttribute('data-type', 'success')
  await expect.element(trigger).toHaveFocus()
  expect(cancelRequests).toEqual([taskId])

  await trigger.click()
  await expect.element(lastExport.getByRole('status')).toHaveTextContent('appLog.export.canceled')
  await submit.click()
  await expect.element(progressDialog.getByText('appLog.export.progressQueued')).toBeVisible()
  await expect.poll(() => statusTaskIds.some((id) => id !== taskId)).toBe(true)
})

it('reports successful cancellation after the user closes the progress dialog', async () => {
  await renderNotifications()
  const cancelResponse = createDeferred<'canceled'>()
  onTestFinished(() => cancelResponse.resolve('canceled'))
  const { trigger, dialog, cancelRequests } = await openExport(false, 'chat', {
    getTaskStatus: () => ({ status: 'pending' }),
    cancelTask: () => cancelResponse.promise,
  })

  await trigger.click()
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await cancelExport.click()
  await expect.poll(() => cancelRequests).toEqual([taskId])
  await progressClose.click()
  await expect.element(progressDialog).not.toBeInTheDocument()
  await expect.element(canceledToast).not.toBeInTheDocument()

  cancelResponse.resolve('canceled')
  await expect.element(canceledToast).toBeVisible()
})

it('shows the running export when the worker starts before cancellation', async () => {
  await renderNotifications()
  let status: ConversationLogExportStatusResponse['status'] = 'pending'
  const { trigger, dialog, cancelRequests } = await openExport(false, 'chat', {
    getTaskStatus: () => ({ status }),
    cancelTask: () => {
      status = 'processing'
      return status
    },
  })
  await trigger.click()
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await cancelExport.click()
  await expect.element(progressDialog.getByText('appLog.export.progressPreparing')).toBeVisible()
  await expect.element(cancelExport).not.toBeInTheDocument()
  await expect.element(progressDialog.getByRole('alert')).not.toBeInTheDocument()
  await expect.element(canceledToast).not.toBeInTheDocument()
  expect(cancelRequests).toEqual([taskId])
})

it('opens task progress after creating an export and resumes polling it when reopened', async () => {
  let taskStatus: Pick<ConversationLogExportStatusResponse, 'status' | 'progress'> = {
    status: 'processing',
    progress: null,
  }
  const { screen, appId, trigger, dialog, lastExport, requests, statusTaskIds, renderLogs } =
    await openExport(false, 'chat', {
      previewRows: 300,
      getTaskStatus: () => taskStatus,
    })
  const downloadPaths = observeDownloads()

  await trigger.click()
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(progressDialog.getByText('appLog.export.progressPreparing')).toBeVisible()
  await expect.element(emailWhenFinishedCheckbox).not.toBeInTheDocument()
  await expect.poll(() => statusTaskIds[0]).toBe(taskId)
  expect(requests[0]?.estimated_rows).toBe(300)

  taskStatus = { status: 'processing', progress: { stage: 'writing', rows_written: 125 } }
  await expect.element(progressBar).toHaveAttribute('aria-valuenow', '41')
  taskStatus = { status: 'processing', progress: { stage: 'writing', rows_written: 225 } }
  await expect.element(progressBar).toHaveAttribute('aria-valuenow', '75')
  await progressClose.click()
  await expect.element(progressDialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()

  await screen.unmount()
  const reopened = await renderLogs()
  await reopened.trigger.click()
  await lastExport.getByRole('button', { name: 'appLog.export.viewProgress' }).click()
  await expect.element(progressBar).toHaveAttribute('aria-valuenow', '75')

  taskStatus = { status: 'processing', progress: { stage: 'writing', rows_written: 350 } }
  await expect.element(progressBar).toHaveAttribute('aria-valuenow', '99')
  taskStatus = { status: 'processing', progress: { stage: 'uploading', rows_written: 350 } }
  await expect.element(progressDialog.getByText('appLog.export.progressUploading')).toBeVisible()
  await expect.element(progressBar).toHaveAttribute('aria-valuenow', '99')
  taskStatus = { ...taskStatus, status: 'ready' }
  await expect.element(progressDownload).toBeEnabled()
  await expect.element(progressBar).toHaveAttribute('aria-valuenow', '100')
  expect(statusTaskIds.length).toBeGreaterThan(1)
  expect(new Set(statusTaskIds)).toEqual(new Set([taskId]))
  await progressDownload.click()
  expect(downloadPaths).toEqual([
    `/console/api/apps/${appId}/conversation-log-exports/${taskId}/file`,
  ])
})

it('lets the user opt in or out before completion and shows when a requested email is queued', async () => {
  let status: ConversationLogExportStatusResponse['status'] = 'processing'
  const initialStatus = createDeferred()
  onTestFinished(() => initialStatus.resolve())
  const { trigger, dialog, emailRequests } = await openExport(false, 'chat', {
    isEmailSetup: true,
    getTaskStatus: () => ({
      status,
      ...(status === 'ready' ? { email_notification: 'queued' } : {}),
    }),
    waitForStatus: () => initialStatus.promise,
    updateEmailNotification: (enabled) => ({ state: enabled ? 'waiting' : 'off' }),
  })
  await trigger.click()
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await expect.element(emailWhenFinishedCheckbox).toBeDisabled()
  initialStatus.resolve()
  await expect.element(emailWhenFinishedCheckbox).toBeEnabled()
  await expect.element(emailWhenFinishedCheckbox).not.toBeChecked()
  await emailWhenFinishedCheckbox.click()
  await expect.element(emailWhenFinishedCheckbox).toBeChecked()
  await expect.element(emailWhenFinishedCheckbox).toBeEnabled()
  await emailWhenFinishedCheckbox.click()
  await expect.element(emailWhenFinishedCheckbox).not.toBeChecked()
  await emailWhenFinishedCheckbox.click()
  await expect.element(emailWhenFinishedCheckbox).toBeChecked()

  status = 'ready'
  await expect.element(progressDownload).toBeEnabled()
  await expect.element(emailWhenFinishedCheckbox).not.toBeInTheDocument()
  await expect.element(progressDialog.getByText('appLog.export.emailQueued')).toBeVisible()
  await expect.element(emailButton).not.toBeInTheDocument()
  expect(emailRequests).toEqual([
    { taskId, enabled: true },
    { taskId, enabled: false },
    { taskId, enabled: true },
  ])
})

it('lets the user retry opting in to email before the export completes', async () => {
  let attempted = false
  const { trigger, dialog, emailRequests } = await openExport(false, 'chat', {
    isEmailSetup: true,
    getTaskStatus: () => ({ status: 'processing' }),
    updateEmailNotification: () => {
      const state = attempted ? 'waiting' : 'off'
      const failed = !attempted
      attempted = true
      return { state, failed }
    },
  })
  await trigger.click()
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await emailWhenFinishedCheckbox.click()
  const emailError = progressDialog.getByText('appLog.export.emailUpdateFailed')
  await expect.element(emailError).toBeVisible()
  await expect.element(emailWhenFinishedCheckbox).toBeEnabled()
  await expect.element(emailWhenFinishedCheckbox).not.toBeChecked()

  await emailWhenFinishedCheckbox.click()
  await expect.element(emailWhenFinishedCheckbox).toBeChecked()
  await expect.element(emailError).not.toBeInTheDocument()
  expect(emailRequests).toEqual([
    { taskId, enabled: true },
    { taskId, enabled: true },
  ])
})

it('hides email when the status response omits the per-export preference', async () => {
  const { trigger, dialog } = await openExport(false, 'chat', {
    isEmailSetup: true,
    omitEmailNotificationOnStatus: true,
    getTaskStatus: () => ({ status: 'processing' }),
  })
  await trigger.click()
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await expect.element(progressDialog.getByText('appLog.export.progressPreparing')).toBeVisible()
  await expect.element(emailWhenFinishedCheckbox).not.toBeInTheDocument()
})

it('offers the CSV download without an email action after an export completes', async () => {
  const { trigger, dialog, emailRequests } = await openExport(false, 'chat', { isEmailSetup: true })
  await trigger.click()
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await expect.element(progressDownload).toBeEnabled()
  await expect.element(emailButton).not.toBeInTheDocument()
  await expect.element(emailWhenFinishedCheckbox).not.toBeInTheDocument()
  expect(emailRequests).toEqual([])
})

it('allows an export after preview fails and shows indeterminate progress with the rows written', async () => {
  const { trigger, dialog, requests } = await openExport(false, 'chat', {
    previewFailure: true,
    getTaskStatus: () => ({
      status: 'processing',
      progress: { stage: 'writing', rows_written: 125 },
    }),
  })
  await trigger.click()
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('appLog.export.previewUnavailable')
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await expect.element(progressDialog.getByText('125 rows written')).toBeVisible()
  expect(requests[0]).not.toHaveProperty('estimated_rows')
  await expect.element(progressBar).not.toHaveAttribute('aria-valuenow')
})

it('can export the same filters again after a CSV is ready', async () => {
  const downloadPaths = observeDownloads()
  const latestRefresh = createDeferred()
  let delayLatest = false
  let latestRefreshing = false
  onTestFinished(() => latestRefresh.resolve())
  const {
    screen,
    appId,
    trigger,
    dialog,
    lastExport,
    listQueries,
    previews,
    requests,
    statusTaskIds,
  } = await openExport(false, 'chat', {
    waitForLatest: () => {
      if (!delayLatest) return undefined
      latestRefreshing = true
      return latestRefresh.promise
    },
  })
  await expect.element(screen.getByText(conversation.summary, { exact: true })).toBeVisible()
  await screen.getByPlaceholder('common.operation.search').fill('refund')
  await expect.poll(() => listQueries.at(-1)?.get('keyword')).toBe('refund')
  await trigger.click()
  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('Conversations 2 · CSV rows 4.')
  expect(previews.at(-1)?.has('keyword')).toBe(false)
  expect(previews.at(-1)?.has('page')).toBe(false)
  await submit.click()
  await expect.element(progressDownload).toBeEnabled()
  await progressClose.click()
  await expect.element(progressDialog).not.toBeInTheDocument()
  await trigger.click()
  const download = lastExport.getByRole('button', { name: 'common.operation.download' })
  await expect.element(download).toBeEnabled()
  await expect.element(submit).toBeEnabled()
  expect(downloadPaths).toEqual([])
  expect(requests).toEqual([
    {
      annotation_status: 'all',
      estimated_rows: 4,
      sort_by: '-created_at',
      start: expect.any(String),
      end: expect.any(String),
    },
  ])
  await submit.click()
  await expect.element(progressDownload).toBeEnabled()
  const nextTaskId = statusTaskIds.at(-1)
  expect(nextTaskId).toBeDefined()
  expect(nextTaskId).not.toBe(taskId)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(downloadPaths).toEqual([])

  await progressClose.click()
  await expect.element(progressDialog).not.toBeInTheDocument()
  delayLatest = true
  await trigger.click()
  await expect.poll(() => latestRefreshing).toBe(true)
  await expect.element(submit).toBeDisabled()
  await expect.element(download).not.toBeInTheDocument()

  latestRefresh.resolve()
  await expect.element(download).toBeEnabled()
  await expect.element(submit).toBeEnabled()
  await download.click()
  expect(downloadPaths).toEqual([
    `/console/api/apps/${appId}/conversation-log-exports/${nextTaskId}/file`,
  ])
})
