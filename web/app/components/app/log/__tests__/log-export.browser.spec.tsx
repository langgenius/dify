import type {
  ConversationLogExportCreatePayload,
  ConversationLogExportLatestTaskResponse,
  ConversationWithSummary,
} from '@dify/contracts/api/console/apps/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import appLogCopy from '@/i18n/locales/en-US/app-log.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Logs from '../index'

vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: copy } = await import('@/i18n/locales/en-US/app-log.json')
  const mock = createReactI18nextMock({
    'export.previewRows': copy['export.previewRows'],
    'export.previewSize': copy['export.previewSize'],
    'export.previewChatflowDescription': copy['export.previewChatflowDescription'],
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

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test${path}`,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/apps/support-assistant/logs',
  useSearchParams: () => new URLSearchParams('page=2'),
}))

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

async function openExport(
  hasExistingTask = false,
  mode: 'chat' | 'agent-chat' | 'advanced-chat' | 'completion' = 'chat',
  waitForPreview?: (query: URLSearchParams) => Promise<void> | undefined,
) {
  const appId = crypto.randomUUID()
  const listQueries: URLSearchParams[] = []
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
        await waitForPreview?.(url.searchParams)
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
    renderLogs,
  }
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

it.each([
  ['chat', 'previewConversationDescription'],
  ['agent-chat', 'previewConversationDescription'],
  ['completion', 'previewCompletionDescription'],
] as const)(
  'uses the list filters and explains the CSV contents for %s',
  async (mode, descriptionKey) => {
    const { screen, trigger, dialog } = await openExport(false, mode)
    await expect
      .element(screen.getByRole('combobox', { name: 'appLog.table.header.endUser' }))
      .toBeVisible()
    await trigger.click()
    await expect
      .element(dialog.getByRole('combobox', { name: 'appLog.export.timeRange' }))
      .toHaveTextContent('appLog.filter.period.last7days')
    await expect
      .element(dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' }))
      .toHaveTextContent('appLog.export.identitiesAll')
    await expect
      .element(dialog.getByRole('combobox', { name: 'appLog.export.scope' }))
      .not.toBeInTheDocument()
    await expect
      .element(dialog.getByText(`appLog.export.${descriptionKey}`, { exact: true }))
      .toBeVisible()
  },
)

it('previews CSV rows and submits a Completion export with the list identities', async () => {
  const { screen, trigger, dialog, lastExport, listQueries, requests } = await openExport(
    false,
    'completion',
  )
  await screen.getByRole('combobox', { name: 'appLog.table.header.endUser' }).click()
  await page.getByRole('option', { name: 'user-1024' }).click()
  await page.getByRole('option', { name: 'Mia Chen' }).click()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  expect(listQueries.at(-1)?.getAll('account_ids')).toEqual([accountId])
  await trigger.click()
  await expect.element(dialog.getByRole('status')).toHaveTextContent('CSV rows 4.')
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()
  await expect
    .element(lastExport.getByRole('button', { name: 'common.operation.download' }))
    .toBeEnabled()
  expect(requests).toEqual([
    expect.objectContaining({ end_user_ids: [endUserId], account_ids: [accountId] }),
  ])
})

it('can export the same filters again after a CSV is ready', async () => {
  const downloadPaths = observeDownloads()
  const { screen, trigger, dialog, lastExport, listQueries, previews, requests } =
    await openExport()
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
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.exporting' }))
    .toBeDisabled()
  const download = lastExport.getByRole('button', { name: 'common.operation.download' })
  await expect.element(download).toBeEnabled()
  await expect.element(submit).toBeEnabled()
  expect(downloadPaths).toEqual([])
  expect(requests).toEqual([
    {
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
  const { appId, trigger, dialog, lastExport, requests } = await openExport(true)
  await trigger.click()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.exporting' }))
    .toBeDisabled()
  const download = lastExport.getByRole('button', { name: 'common.operation.download' })
  await expect.element(download).toBeEnabled()
  await expect.element(lastExport.getByText(/invoice/)).toBeVisible()
  await expect.element(lastExport.getByText(/appLog\.export\.annotated/)).toBeVisible()
  await expect.element(lastExport.getByText(/user-1024/)).toBeVisible()
  await dialog.getByRole('combobox', { name: 'appLog.export.timeRange' }).click()
  await page.getByRole('option', { name: 'appLog.filter.period.allTime' }).click()
  await expect.element(dialog.getByRole('button', { name: 'appLog.export.submit' })).toBeEnabled()
  await download.click()
  expect(downloadPaths).toEqual([
    `/console/api/apps/${appId}/conversation-log-exports/${previousTaskId}/file`,
  ])
  expect(requests).toEqual([])
})

it('shows the last export filters in its own row after the user leaves and returns', async () => {
  const { screen, trigger, dialog, lastExport, renderLogs, requests } = await openExport()
  await trigger.click()
  const period = dialog.getByRole('combobox', { name: 'appLog.export.timeRange' })
  await period.click()
  await page.getByRole('option', { name: 'appLog.filter.period.last4weeks' }).click()
  const identities = dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' })
  await identities.click()
  await page.getByRole('option', { name: 'user-1024' }).click()
  await userEvent.keyboard('{Escape}')
  await dialog.getByRole('button', { name: 'appLog.export.submit' }).click()

  await expect
    .element(lastExport.getByRole('status'))
    .toHaveTextContent('appLog.archives.downloadHint.preparing')
  await dialog.getByRole('button', { name: 'common.operation.close' }).last().click()
  await expect.element(dialog).not.toBeInTheDocument()
  await screen.unmount()
  const reopened = await renderLogs()
  await reopened.trigger.click()
  await expect.element(period).toHaveTextContent('appLog.filter.period.last7days')
  await expect.element(identities).toHaveTextContent('appLog.export.identitiesAll')
  const { start, end } = requests[0]!
  await expect.element(lastExport.getByText(`${start} – ${end}`)).toBeVisible()
  await expect.element(lastExport.getByText(/user-1024/)).toBeVisible()
  await expect
    .element(lastExport.getByRole('button', { name: 'common.operation.download' }))
    .toBeEnabled()
})

it('can select identities beyond the visible Logs page when exporting legacy Agent logs', async () => {
  const { trigger, dialog, previews, requests } = await openExport(false, 'agent-chat')
  await trigger.click()
  const period = dialog.getByRole('combobox', { name: 'appLog.export.timeRange' })
  await expect.element(period).toHaveTextContent('appLog.filter.period.last7days')
  const identityLabel = 'appLog.table.header.endUser'
  await dialog.getByRole('combobox', { name: identityLabel }).click()
  const picker = page.getByRole('dialog', { name: identityLabel })
  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await picker.getByRole('option', { name: 'user-1024' }).click()
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('Conversations 1 · CSV rows 2.')
  await picker.getByRole('option', { name: 'Mia Chen' }).click()
  await expect
    .element(picker.getByRole('button', { name: 'common.operation.clear' }))
    .not.toBeInTheDocument()
  const search = picker.getByRole('combobox', { name: 'common.operation.search' })
  await search.fill('42')
  await picker.getByRole('option', { name: olderEndUser.label }).click()
  await expect
    .element(dialog.getByRole('status'))
    .toHaveTextContent('Conversations 3 · CSV rows 6.')
  await expect.element(submit).toBeEnabled()
  expect(previews.at(-1)?.getAll('end_user_ids')).toEqual([endUserId, olderEndUser.id])
  expect(previews.at(-1)?.getAll('account_ids')).toEqual([accountId])
  expect(previews.at(-1)?.has('start')).toBe(true)
  expect(previews.at(-1)?.has('end')).toBe(true)
  await search.click()
  await userEvent.keyboard('{Enter}')
  expect(requests).toEqual([])
  await userEvent.keyboard('{Escape}')
  await period.click()
  await page.getByRole('option', { name: 'appLog.filter.period.allTime' }).click()
  await expect.poll(() => previews.at(-1)?.has('start')).toBe(false)
  expect(previews.at(-1)?.has('end')).toBe(false)
})

it('keeps the export dialog height stable while recounting after an identity change', async () => {
  await page.viewport(768, 900)
  const recount = createDeferred()
  onTestFinished(() => recount.resolve())
  const { trigger, dialog } = await openExport(false, 'advanced-chat', (query) =>
    query.has('end_user_ids') ? recount.promise : undefined,
  )
  await trigger.click()
  const count = dialog.getByRole('status')
  await expect.element(count).toHaveTextContent('Conversations 2 · CSV rows 4.')
  expect(count.element().parentElement?.textContent).toBe(
    `Conversations 2 · CSV rows 4. ${appLogCopy['export.previewChatflowDescription']}`,
  )
  const dialogHeight = () => (dialog.element() as HTMLElement).offsetHeight
  const initialHeight = dialogHeight()

  await dialog.getByRole('combobox', { name: 'appLog.table.header.endUser' }).click()
  await page.getByRole('option', { name: 'user-1024' }).click()
  await expect.element(count).toHaveTextContent('appLog.detail.loading…')
  await expect.element(dialog.getByRole('button', { name: 'appLog.export.submit' })).toBeDisabled()
  expect(dialogHeight()).toBe(initialHeight)

  recount.resolve()
  await expect.element(count).toHaveTextContent('Conversations 1 · CSV rows 2.')
  expect(dialogHeight()).toBe(initialHeight)
})

it('shares the Chatflow list filters with export while keeping a separate export draft', async () => {
  const { screen, dialog, listQueries, previews, requests } = await openExport(
    false,
    'advanced-chat',
  )
  const identityLabel = 'appLog.table.header.endUser'
  const listIdentity = screen.getByRole('combobox', { name: identityLabel })
  const listSearch = screen.getByPlaceholder('common.operation.search')
  const identitySearch = page
    .getByRole('dialog', { name: identityLabel })
    .getByRole('combobox', { name: 'common.operation.search' })
  const listFieldHeight = () => listIdentity.element().getBoundingClientRect().height
  const endUserOption = page.getByRole('option', { name: 'user-1024' })
  const accountOption = page.getByRole('option', { name: 'Mia Chen' })
  const firstTwoIdentities = 'user-1024, Mia Chen'

  await expect.element(listIdentity).toHaveAttribute('type', 'button')
  const initialHeight = listFieldHeight()
  await expect.element(identitySearch).not.toBeInTheDocument()
  await listIdentity.click()
  await identitySearch.fill('1024')
  await endUserOption.click()
  await expect.element(listIdentity).toHaveAttribute('aria-expanded', 'true')
  await expect.element(identitySearch).toHaveValue('1024')
  await identitySearch.fill('')
  await accountOption.click()
  await expect.element(listIdentity).toHaveAttribute('aria-expanded', 'true')
  await expect.element(listIdentity.getByText(firstTwoIdentities, { exact: true })).toBeVisible()
  expect(listFieldHeight()).toBe(initialHeight)
  expect(listQueries.at(-1)?.has('end_user_ids')).toBe(false)
  expect(listQueries.at(-1)?.has('account_ids')).toBe(false)

  await accountOption.click()
  await screen.getByText('appLog.title', { exact: true }).click()
  await expect.poll(() => listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  await expect
    .element(screen.getByText('Change the email on my account', { exact: true }))
    .not.toBeInTheDocument()

  await listSearch.fill('refund')
  await expect.poll(() => listQueries.at(-1)?.get('keyword')).toBe('refund')
  await screen.getByRole('button', { name: /common.sorting.sortBy/ }).click()
  await page.getByRole('menuitemradio', { name: 'appLog.table.header.updatedTime' }).click()
  await expect.poll(() => listQueries.at(-1)?.get('sort_by')).toBe('-updated_at')

  await listIdentity.click()
  await accountOption.click()
  await expect.element(listIdentity).toHaveAttribute('aria-expanded', 'true')
  expect(listQueries.at(-1)?.has('account_ids')).toBe(false)
  await screen.getByText('appLog.export.title', { exact: true }).click()
  await expect.poll(() => listQueries.at(-1)?.getAll('account_ids')).toEqual([accountId])
  expect(listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  const exportIdentity = dialog.getByRole('combobox', { name: identityLabel })
  await expect.element(exportIdentity).toBeVisible()
  const exportFieldHeight = () => exportIdentity.element().getBoundingClientRect().height
  const initialExportHeight = exportFieldHeight()
  const twoVisibleIdentities = exportIdentity.getByText(firstTwoIdentities, { exact: true })
  await expect.element(twoVisibleIdentities).toBeVisible()
  await expect.element(dialog.getByPlaceholder('common.operation.search')).not.toBeInTheDocument()
  await expect
    .element(dialog.getByRole('button', { name: /common.sorting.sortBy/ }))
    .not.toBeInTheDocument()
  await expect
    .element(dialog.getByText(appLogCopy['export.previewChatflowDescription'], { exact: true }))
    .toBeVisible()
  expect(previews.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  expect(previews.at(-1)?.getAll('account_ids')).toEqual([accountId])
  expect(previews.at(-1)?.has('keyword')).toBe(false)
  expect(previews.at(-1)?.get('sort_by')).toBe('-updated_at')

  await exportIdentity.click()
  await identitySearch.fill('42')
  await page.getByRole('option', { name: olderEndUser.label }).click()
  await expect
    .poll(() => previews.at(-1)?.getAll('end_user_ids'))
    .toEqual([endUserId, olderEndUser.id])
  const allIdentities = exportIdentity.getByText('user-1024, Mia Chen, customer-42', {
    exact: true,
  })
  await expect.element(allIdentities).toBeVisible()
  expect(exportFieldHeight()).toBe(initialExportHeight)
  expect(listQueries.at(-1)?.getAll('end_user_ids')).toEqual([endUserId])
  await userEvent.keyboard('{Escape}')
  await expect.element(exportIdentity).toHaveAttribute('aria-expanded', 'false')

  const { innerWidth, innerHeight } = window
  await page.viewport(280, innerHeight)
  await expect.element(twoVisibleIdentities).toBeVisible()
  await expect.element(exportIdentity.getByText('+1', { exact: true }).first()).toBeVisible()
  expect(exportFieldHeight()).toBe(initialExportHeight)
  await page.viewport(innerWidth, innerHeight)
  await expect.element(allIdentities).toBeVisible()

  await dialog.getByRole('combobox', { name: 'appLog.export.timeRange' }).click()
  await page.getByRole('option', { name: 'appLog.filter.period.allTime' }).click()
  await expect.poll(() => previews.at(-1)?.has('start')).toBe(false)
  expect(listQueries.at(-1)?.has('start')).toBe(true)

  await dialog.getByRole('combobox', { name: 'appAnnotation.title' }).click()
  await page.getByRole('option', { name: 'appLog.filter.annotation.not_annotated' }).click()
  await expect.poll(() => previews.at(-1)?.get('annotation_status')).toBe('not_annotated')
  expect(listQueries.at(-1)?.get('annotation_status')).toBe('all')

  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await expect.element(submit).toBeEnabled()
  await submit.click()
  await expect
    .poll(() => requests)
    .toEqual([
      {
        annotation_status: 'not_annotated',
        end_user_ids: [endUserId, olderEndUser.id],
        account_ids: [accountId],
        sort_by: '-updated_at',
      },
    ])
})
