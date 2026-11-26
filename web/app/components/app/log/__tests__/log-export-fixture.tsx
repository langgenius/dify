import type {
  ConversationLogExportCreatePayload,
  ConversationLogExportLatestTaskResponse,
  ConversationLogExportStatusResponse,
  ConversationWithSummary,
} from '@dify/contracts/api/console/apps/types.gen'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Logs from '../index'

export const taskId = 'bfb96e29-3cf9-4874-9c82-12a54749767a'
export const previousTaskId = '6b37bf24-2bfe-4b69-821c-3687c7b83bec'
export const endUserId = 'e0c627f9-78d3-4dce-86a0-a19e245f465b'
export const accountId = '3eb56edf-8a82-42b0-bca3-93128b83d64d'
export const olderEndUser = {
  id: '14d8f121-7854-4b3f-88cb-b9bb1b64e7ba',
  label: 'customer-42',
  source: 'end-user',
}

export const conversation: ConversationWithSummary = {
  id: 'conversation-1',
  name: 'How do I get a refund?',
  summary: 'How do I get a refund?',
  from_end_user_id: endUserId,
  from_end_user_session_id: 'user-1024',
  from_source: 'api',
  annotated: false,
  status: 'normal',
  message_count: 2,
  created_at: 1794951000,
  updated_at: 1794951120,
}
const conversations: ConversationWithSummary[] = [
  conversation,
  {
    ...conversation,
    id: 'conversation-2',
    name: 'Change the email on my account',
    summary: 'Change the email on my account',
    from_source: 'console',
    from_end_user_id: null,
    from_end_user_session_id: null,
    from_account_id: accountId,
    from_account_name: 'Mia Chen',
  },
]

export async function openExport(
  hasExistingTask = false,
  mode: 'chat' | 'agent-chat' | 'advanced-chat' | 'completion' = 'chat',
  responses?: {
    waitForPreview?: (query: URLSearchParams) => Promise<void> | undefined
    waitForLatest?: () => Promise<void> | undefined
    waitForStatus?: () => Promise<void>
    previewRows?: number
    previewFailure?: boolean
    createFailure?: 'response-lost' | 'active-export'
    existingTaskExpiresAt?: string
    isEmailSetup?: boolean
    omitEmailNotificationOnStatus?: boolean
    timezone?: string
    getTaskStatus?: () => Pick<
      ConversationLogExportStatusResponse,
      'status' | 'progress' | 'email_notification'
    >
    cancelTask?: () => 'canceled' | 'processing' | Promise<'canceled' | 'processing'>
    updateEmailNotification?: (enabled: boolean) => {
      state: NonNullable<ConversationLogExportStatusResponse['email_notification']>
      failed?: boolean
    }
  },
) {
  const appId = crypto.randomUUID()
  const listQueries: URLSearchParams[] = []
  const previews: URLSearchParams[] = []
  const requests: ConversationLogExportCreatePayload[] = []
  const emailRequests: { taskId: string; enabled: boolean }[] = []
  const cancelRequests: string[] = []
  const statusTaskIds: string[] = []
  let task: ConversationLogExportLatestTaskResponse | null = hasExistingTask
    ? {
        task_id: previousTaskId,
        status: 'processing',
        expires_at: responses?.existingTaskExpiresAt,
        identity_labels: [{ id: endUserId, label: 'user-1024', source: 'end-user' }],
        filters: {
          start: '2026-11-16T00:00:00Z',
          end: '2026-11-19T23:59:59Z',
          end_user_ids: [endUserId],
          account_ids: [],
          annotation_status: 'annotated',
          sort_by: '-updated_at',
          keyword: 'invoice',
        },
      }
    : null
  let statusReads = 0
  const limitReached = () =>
    Response.json(
      { code: 'log_export_limit_reached', message: 'The export limit was reached.', status: 429 },
      { status: 429 },
    )
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input)
    const url = new URL(request.url)
    const route = url.pathname.split(`/apps/${appId}/`)[1]
    switch (route) {
      case 'chat-conversations':
      case 'completion-conversations': {
        listQueries.push(url.searchParams)
        const endUserIds = url.searchParams.getAll('end_user_ids')
        const accountIds = url.searchParams.getAll('account_ids')
        const data =
          endUserIds.length || accountIds.length
            ? conversations.filter(
                (log) =>
                  endUserIds.includes(log.from_end_user_id ?? '') ||
                  accountIds.includes(log.from_account_id ?? ''),
              )
            : conversations
        return Response.json({ data, total: 38, page: 2, limit: 10, has_more: true })
      }
      case 'chat-conversations/identity-options':
        return Response.json({
          data: url.searchParams.get('keyword') === '42' ? [olderEndUser] : [],
        })
      case 'annotations/count':
        return Response.json({ count: 0 })
      case 'conversation-log-exports/preview': {
        previews.push(url.searchParams)
        await responses?.waitForPreview?.(url.searchParams)
        if (responses?.previewFailure)
          return Response.json({ message: 'Preview unavailable' }, { status: 500 })
        const identities =
          url.searchParams.getAll('end_user_ids').length +
          url.searchParams.getAll('account_ids').length
        const count = identities || 2
        return Response.json({
          counts: { conversation_count: count, message_count: responses?.previewRows ?? count * 2 },
        })
      }
      case 'conversation-log-exports': {
        expect(request.method).toBe('POST')
        const filters: ConversationLogExportCreatePayload = await request.json()
        requests.push(filters)
        task = {
          task_id: requests.length === 1 ? taskId : crypto.randomUUID(),
          status: 'pending',
          estimated_rows: filters.estimated_rows,
          identity_labels: filters.identity_labels ?? [],
          filters: {
            start: filters.start ? `${filters.start.replace(' ', 'T')}:00Z` : null,
            end: filters.end ? `${filters.end.replace(' ', 'T')}:59Z` : null,
            end_user_ids: filters.end_user_ids ?? [],
            account_ids: filters.account_ids ?? [],
            annotation_status: filters.annotation_status ?? 'all',
            sort_by: filters.sort_by ?? '-updated_at',
            keyword: filters.keyword ?? null,
          },
        }
        statusReads = 0
        if (responses?.createFailure === 'response-lost') throw new TypeError('Failed to fetch')
        if (responses?.createFailure === 'active-export') return limitReached()
        return Response.json(
          {
            task_id: task.task_id,
            status: task.status,
            estimated_rows: task.estimated_rows,
          },
          { status: 202 },
        )
      }
      case 'conversation-log-exports/latest':
        await responses?.waitForLatest?.()
        if (!task) return Response.json({ task: null })
        if (task.status !== 'canceled')
          task = {
            ...task,
            ...(responses?.getTaskStatus?.() ?? {
              status: task.status !== 'ready' && ++statusReads === 1 ? 'processing' : 'ready',
            }),
          }
        return Response.json({ task })
      default:
        if (task && route === `conversation-log-exports/${task.task_id}/cancel`) {
          expect(request.method).toBe('POST')
          cancelRequests.push(task.task_id)
          const status = await responses?.cancelTask?.()
          task = { ...task, status: status ?? 'canceled' }
          if (task.status === 'canceled')
            return Response.json({ task_id: task.task_id, status: task.status })
          return Response.json(
            {
              code: 'log_export_task_not_cancelable',
              message: 'The export has started.',
              status: 409,
            },
            { status: 409 },
          )
        }
        if (task && route === `conversation-log-exports/${task.task_id}`) {
          if (request.method === 'PUT' && responses?.updateEmailNotification) {
            const { enabled } = (await request.json()) as { enabled: boolean }
            emailRequests.push({ taskId: task.task_id, enabled })
            const { state, failed } = responses.updateEmailNotification(enabled)
            task = { ...task, email_notification: state }
            if (failed)
              return Response.json(
                { message: 'Email notification update unavailable' },
                { status: 500 },
              )
            return Response.json({ email_notification: state })
          }
          statusTaskIds.push(task.task_id)
          await responses?.waitForStatus?.()
          if (task.status !== 'canceled')
            task = { ...task, ...(responses?.getTaskStatus?.() ?? { status: 'ready' }) }
          return Response.json({
            task_id: task.task_id,
            status: task.status,
            progress: task.progress,
            estimated_rows: task.estimated_rows,
            email_notification:
              responses?.isEmailSetup && !responses.omitEmailNotificationOnStatus
                ? (task.email_notification ?? 'off')
                : undefined,
          })
        }
        throw new Error(`Unexpected request ${url.pathname}`)
    }
  })
  onTestFinished(() => fetch.mockRestore())

  const dialog = page.getByRole('dialog', { name: 'appLog.export.title' })
  const lastExport = dialog.getByRole('group', { name: 'appLog.export.last' })
  const renderLogs = async () => {
    const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
      accountProfile: { timezone: responses?.timezone ?? 'UTC' },
      currentWorkspace: { role: 'admin' },
      systemFeatures: {
        deployment_edition: 'COMMUNITY',
        is_email_setup: responses?.isEmailSetup ?? false,
      },
    })
    const { wrapper: UrlState } = createNuqsTestWrapper({ hasMemory: true })
    const screen = await render(
      <ConsoleProvider>
        <UrlState>
          <div className="min-h-dvh bg-background-body px-8 py-6">
            <Logs
              appDetail={createAppDetailFixture({
                id: appId,
                mode,
                name: 'Support Assistant',
              })}
            />
          </div>
        </UrlState>
      </ConsoleProvider>,
    )
    return { screen, trigger: screen.getByRole('button', { name: 'appLog.export.title' }) }
  }
  return {
    ...(await renderLogs()),
    dialog,
    lastExport,
    listQueries,
    appId,
    previews,
    requests,
    emailRequests,
    cancelRequests,
    statusTaskIds,
    renderLogs,
  }
}

export function observeDownloads() {
  const downloadPaths: string[] = []
  const followLink = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadPaths.push(new URL(this.href).pathname)
  })
  onTestFinished(() => followLink.mockRestore())
  return downloadPaths
}
