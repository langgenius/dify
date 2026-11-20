import type {
  ConversationLogExportCreatePayload,
  ConversationLogExportLatestTaskResponse,
  ConversationWithSummary,
} from '@dify/contracts/api/console/apps/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Logs from '../index'

vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const mock = createReactI18nextMock()
  return {
    ...original,
    ...mock,
    useTranslation: (...args: Parameters<typeof mock.useTranslation>) => ({
      ...mock.useTranslation(...args),
      ready: true,
    }),
  }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test${path}`,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/apps/support-assistant/logs',
  useSearchParams: () => new URLSearchParams('page=2'),
}))

const appId = '2015f4b7-90e7-4c04-a4a7-9ce976816d69'
const taskId = 'bfb96e29-3cf9-4874-9c82-12a54749767a'
const previousTaskId = '6b37bf24-2bfe-4b69-821c-3687c7b83bec'
const endUserId = 'e0c627f9-78d3-4dce-86a0-a19e245f465b'
const accountId = '3eb56edf-8a82-42b0-bca3-93128b83d64d'
const olderEndUser = {
  id: '14d8f121-7854-4b3f-88cb-b9bb1b64e7ba',
  label: 'customer-42',
  source: 'end-user',
}

const conversation: ConversationWithSummary = {
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

async function openExport(hasExistingTask = false) {
  const previews: URLSearchParams[] = []
  const requests: ConversationLogExportCreatePayload[] = []
  let task: ConversationLogExportLatestTaskResponse | null = hasExistingTask
    ? {
        task_id: previousTaskId,
        status: 'processing',
        filters: {
          start: '2026-11-16T00:00:00Z',
          end: '2026-11-19T23:59:59Z',
          end_user_ids: [endUserId],
          account_ids: [],
          annotation_status: 'annotated',
          keyword: 'invoice',
        },
      }
    : null
  let statusReads = 0
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input)
    const url = new URL(request.url)
    const route = url.pathname.split(`/apps/${appId}/`)[1]
    switch (route) {
      case 'chat-conversations':
        return Response.json({ data: conversations, total: 38, page: 2, limit: 10, has_more: true })
      case 'chat-conversations/identity-options':
        return Response.json({
          data: url.searchParams.get('keyword') === '42' ? [olderEndUser] : [],
        })
      case 'annotations/count':
        return Response.json({ count: 0 })
      case 'conversation-log-exports/preview': {
        previews.push(url.searchParams)
        const identities =
          url.searchParams.getAll('end_user_ids').length +
          url.searchParams.getAll('account_ids').length
        const count = identities || 2
        return Response.json({
          counts: { conversation_count: count, message_count: count * 2 },
        })
      }
      case 'conversation-log-exports': {
        expect(request.method).toBe('POST')
        const filters: ConversationLogExportCreatePayload = await request.json()
        requests.push(filters)
        task = {
          task_id: requests.length === 1 ? taskId : crypto.randomUUID(),
          status: 'pending',
          filters: {
            start: filters.start ? `${filters.start.replace(' ', 'T')}:00Z` : null,
            end: filters.end ? `${filters.end.replace(' ', 'T')}:59Z` : null,
            end_user_ids: filters.end_user_ids ?? [],
            account_ids: filters.account_ids ?? [],
            annotation_status: filters.annotation_status ?? 'all',
            keyword: filters.keyword ?? null,
          },
        }
        statusReads = 0
        return Response.json({ task_id: task.task_id, status: task.status }, { status: 202 })
      }
      case 'conversation-log-exports/latest':
        if (!task) return Response.json({ task: null })
        statusReads++
        return Response.json({
          task: { ...task, status: statusReads === 1 ? 'processing' : 'ready' },
        })
      default:
        throw new Error(`Unexpected request ${url.pathname}`)
    }
  })
  onTestFinished(() => fetch.mockRestore())

  const dialog = page.getByRole('dialog', { name: 'appLog.export.title' })
  const lastExport = dialog.getByRole('group', { name: 'appLog.export.last' })
  const renderLogs = async () => {
    const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
      accountProfile: { timezone: 'UTC' },
      currentWorkspace: { role: 'admin' },
      systemFeatures: { deployment_edition: 'COMMUNITY' },
    })
    const { wrapper: UrlState } = createNuqsTestWrapper({ hasMemory: true })
    const screen = await render(
      <ConsoleProvider>
        <UrlState>
          <div className="min-h-dvh bg-background-body px-8 py-6">
            <Logs
              appDetail={createAppDetailFixture({
                id: appId,
                mode: 'advanced-chat',
                name: 'Support Assistant',
              })}
            />
          </div>
        </UrlState>
      </ConsoleProvider>,
    )
    return { screen, trigger: screen.getByRole('button', { name: 'appLog.export.title' }) }
  }
  return { ...(await renderLogs()), dialog, lastExport, previews, requests, renderLogs }
}

function observeDownloads() {
  const downloadPaths: string[] = []
  const followLink = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadPaths.push(new URL(this.href).pathname)
  })
  onTestFinished(() => followLink.mockRestore())
  return downloadPaths
}

it('can export the same filters again after a CSV is ready', async () => {
  const downloadPaths = observeDownloads()
  const { screen, trigger, dialog, lastExport, previews, requests } = await openExport()
  await expect.element(screen.getByText(conversation.summary, { exact: true })).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'appLog.table.header.endUser' }))
    .not.toBeInTheDocument()
  await screen.getByPlaceholder('common.operation.search').fill('refund')
  await trigger.click()
  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await expect
    .element(dialog.getByRole('combobox', { name: 'appLog.export.scope' }))
    .toHaveTextContent('appLog.export.current')
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('appLog.export.previewSize:{"conversations":2,"rows":4}')
  expect(previews.at(-1)?.get('keyword')).toBe('refund')
  expect(previews.at(-1)?.has('page')).toBe(false)
  await submit.click()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.exporting' }))
    .toBeDisabled()
  const download = lastExport.getByRole('button', { name: 'common.operation.download' })
  await expect.element(download).toBeEnabled()
  await expect.element(lastExport.getByText(/refund/)).toBeVisible()
  await expect.element(submit).toBeEnabled()
  expect(downloadPaths).toEqual([])
  expect(requests).toEqual([
    {
      keyword: 'refund',
      annotation_status: 'all',
      sort_by: '-created_at',
      start: expect.any(String),
      end: expect.any(String),
    },
  ])
  await submit.click()
  await expect
    .element(lastExport.getByRole('status'))
    .toHaveTextContent('appLog.archives.downloadHint.preparing')
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(downloadPaths).toEqual([])
})

it('keeps the previous export and Download available while editing the form', async () => {
  const downloadPaths = observeDownloads()
  const { trigger, dialog, lastExport, requests } = await openExport(true)
  await trigger.click()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.exporting' }))
    .toBeDisabled()
  const download = lastExport.getByRole('button', { name: 'common.operation.download' })
  await expect.element(download).toBeEnabled()
  await expect.element(lastExport.getByText(/invoice/)).toBeVisible()
  await expect.element(lastExport.getByText(/appLog\.export\.annotated/)).toBeVisible()
  await expect.element(lastExport.getByText(/user-1024/)).toBeVisible()
  await dialog.getByRole('combobox', { name: 'appLog.export.scope' }).click()
  await page.getByRole('option', { name: 'appLog.export.all' }).click()
  await expect.element(dialog.getByRole('button', { name: 'appLog.export.submit' })).toBeEnabled()
  await download.click()
  expect(downloadPaths).toEqual([
    `/console/api/apps/${appId}/conversation-log-exports/${previousTaskId}/file`,
  ])
  expect(requests).toEqual([])
})

it('shows the last export filters in its own row after the user leaves and returns', async () => {
  const { screen, trigger, dialog, lastExport, renderLogs } = await openExport()
  await trigger.click()
  const scope = dialog.getByRole('combobox', { name: 'appLog.export.scope' })
  await scope.click()
  await page.getByRole('option', { name: 'appLog.export.all' }).click()
  await dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' }).click()
  await page.getByRole('option', { name: 'appLog.export.identitiesSelected' }).click()
  const user = dialog.getByRole('checkbox', { name: 'user-1024' })
  await user.click()
  const period = dialog.getByRole('combobox', { name: 'appLog.export.timeRange' })
  await period.click()
  await page.getByRole('option', { name: 'appLog.filter.period.custom' }).click()
  const start = dialog.getByLabelText('time.picker.startDate')
  const end = dialog.getByLabelText('time.picker.endDate')
  await start.fill('2026-11-16')
  await end.fill('2026-11-19')
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()

  await expect
    .element(lastExport.getByRole('status'))
    .toHaveTextContent('appLog.archives.downloadHint.preparing')
  await dialog.getByRole('button', { name: 'common.operation.close' }).last().click()
  await expect.element(dialog).not.toBeInTheDocument()
  await screen.unmount()
  const reopened = await renderLogs()
  await reopened.trigger.click()
  await expect.element(scope).toHaveTextContent('appLog.export.current')
  await expect.element(period).not.toBeInTheDocument()
  await expect.element(start).not.toBeInTheDocument()
  await expect.element(lastExport.getByText(/2026-11-16 00:00 – 2026-11-19 23:59/)).toBeVisible()
  await expect.element(lastExport.getByText(/user-1024/)).toBeVisible()
  await expect
    .element(lastExport.getByRole('button', { name: 'common.operation.download' }))
    .toBeEnabled()
})

it('shows an inline identity list and previews selections beyond the visible Logs page', async () => {
  const { trigger, dialog, previews, requests } = await openExport()
  await trigger.click()
  await dialog.getByRole('combobox', { name: 'appLog.export.scope' }).click()
  await page.getByRole('option', { name: 'appLog.export.all' }).click()
  const period = dialog.getByRole('combobox', { name: 'appLog.export.timeRange' })
  await expect.element(period).toHaveTextContent('appLog.filter.period.last7days')
  const identities = dialog.getByRole('group', { name: 'appLog.table.header.endUser' })
  await expect.element(identities).not.toBeInTheDocument()
  await dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' }).click()
  await page.getByRole('option', { name: 'appLog.export.identitiesSelected' }).click()
  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await expect.element(submit).toBeDisabled()
  await expect
    .element(dialog.getByRole('alert'))
    .toHaveTextContent('appLog.export.identityRequired')
  await identities.getByRole('checkbox', { name: 'user-1024' }).click()
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('appLog.export.previewSize:{"conversations":1,"rows":2}')
  await identities.getByRole('checkbox', { name: 'Mia Chen' }).click()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.clear' }))
    .not.toBeInTheDocument()
  const search = dialog.getByRole('searchbox', { name: 'common.operation.search' })
  await search.fill('42')
  await identities.getByRole('checkbox', { name: olderEndUser.label }).click()
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('appLog.export.previewSize:{"conversations":3,"rows":6}')
  await expect.element(submit).toBeEnabled()
  expect(previews.at(-1)?.getAll('end_user_ids')).toEqual([endUserId, olderEndUser.id])
  expect(previews.at(-1)?.getAll('account_ids')).toEqual([accountId])
  expect(previews.at(-1)?.has('start')).toBe(true)
  expect(previews.at(-1)?.has('end')).toBe(true)
  await search.click()
  await userEvent.keyboard('{Enter}')
  expect(requests).toEqual([])
  await period.click()
  await page.getByRole('option', { name: 'appLog.filter.period.allTime' }).click()
  await expect.poll(() => previews.at(-1)?.has('start')).toBe(false)
  expect(previews.at(-1)?.has('end')).toBe(false)
})
