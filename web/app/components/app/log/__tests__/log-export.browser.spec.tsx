import type { ConversationWithSummary } from '@dify/contracts/api/console/apps/types.gen'
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

async function openExport() {
  const listQueries: URLSearchParams[] = []
  const previews: URLSearchParams[] = []
  const requests: unknown[] = []
  let statusReads = 0
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input)
    const url = new URL(request.url)
    const route = url.pathname.split(`/apps/${appId}/`)[1]
    switch (route) {
      case 'chat-conversations': {
        listQueries.push(url.searchParams)
        const users = url.searchParams.getAll('end_user_ids')
        const accounts = url.searchParams.getAll('account_ids')
        const data =
          users.length || accounts.length
            ? conversations.filter(
                (row) =>
                  users.includes(row.from_end_user_id ?? '') ||
                  accounts.includes(row.from_account_id ?? ''),
              )
            : conversations
        return Response.json({ data, total: 38, page: 2, limit: 10, has_more: true })
      }
      case 'chat-conversations/identity-options':
        return Response.json({
          data: url.searchParams.get('keyword') === olderEndUser.label ? [olderEndUser] : [],
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
      case 'conversation-log-exports':
        expect(request.method).toBe('POST')
        requests.push(await request.json())
        return Response.json({ task_id: taskId, status: 'pending' }, { status: 202 })
      case `conversation-log-exports/${taskId}`:
        statusReads++
        return Response.json({
          task_id: taskId,
          status: statusReads === 1 ? 'processing' : 'ready',
        })
      default:
        throw new Error(`Unexpected request ${url.pathname}`)
    }
  })
  onTestFinished(() => fetch.mockRestore())

  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
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
  const trigger = screen.getByRole('button', { name: 'appLog.export.title' })
  const dialog = page.getByRole('dialog', { name: 'appLog.export.title' })
  return { screen, trigger, dialog, listQueries, previews, requests }
}

it('exports the current filters across pages and downloads when the task is ready', async () => {
  const downloadPaths: string[] = []
  const followLink = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadPaths.push(new URL(this.href).pathname)
  })
  onTestFinished(() => followLink.mockRestore())
  const { screen, trigger, dialog, listQueries, previews, requests } = await openExport()
  await expect.element(screen.getByText(conversation.summary, { exact: true })).toBeVisible()
  await screen.getByRole('button', { name: 'appLog.table.header.endUser' }).click()
  await page.getByRole('checkbox', { name: 'user-1024' }).click()
  await expect.poll(() => listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  await expect
    .element(screen.getByText('Change the email on my account', { exact: true }))
    .not.toBeInTheDocument()
  await page.getByRole('checkbox', { name: 'Mia Chen' }).click()
  await userEvent.keyboard('{Escape}')
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
  await expect.element(dialog).not.toBeInTheDocument()
  expect(requests).toEqual([
    {
      keyword: 'refund',
      annotation_status: 'all',
      sort_by: '-created_at',
      end_user_ids: [endUserId],
      account_ids: [accountId],
      start: expect.any(String),
      end: expect.any(String),
    },
  ])
  expect(downloadPaths).toEqual([
    `/console/api/apps/${appId}/conversation-log-exports/${taskId}/file`,
  ])
})

it('finds identities beyond the visible Logs page and previews the selected IDs', async () => {
  const { trigger, dialog, previews } = await openExport()
  await trigger.click()
  await dialog.getByRole('combobox', { name: 'appLog.export.scope' }).click()
  await page.getByRole('option', { name: 'appLog.export.all' }).click()
  await dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' }).click()
  await page.getByRole('option', { name: 'appLog.export.identitiesSelected' }).click()
  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await expect.element(submit).toBeDisabled()
  await expect
    .element(dialog.getByRole('alert'))
    .toHaveTextContent('appLog.export.identityRequired')
  await dialog.getByRole('button', { name: 'appLog.table.header.endUser' }).click()
  await page.getByRole('checkbox', { name: 'user-1024' }).click()
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('appLog.export.previewSize:{"conversations":1,"rows":2}')
  await page.getByRole('checkbox', { name: 'Mia Chen' }).click()
  await page.getByRole('searchbox', { name: 'common.operation.search' }).fill(olderEndUser.label)
  await page.getByRole('checkbox', { name: olderEndUser.label }).click()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('appLog.export.previewSize:{"conversations":3,"rows":6}')
  await expect.element(submit).toBeEnabled()
  expect(previews.at(-1)?.getAll('end_user_ids')).toEqual([endUserId, olderEndUser.id])
  expect(previews.at(-1)?.getAll('account_ids')).toEqual([accountId])
  expect(previews.at(-1)?.has('start')).toBe(false)
})
