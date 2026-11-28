import type {
  WorkflowAppLogPartialResponse,
  WorkflowLogExportLatestTaskResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Logs from '../index'

const appId = '39fa5551-dc66-483f-9f30-44c178f75983'
const taskId = '419fd6d3-861f-4159-a7fe-7220fe78a5e2'
const endUserId = 'bb51d8cd-33cc-4725-a138-986e55176833'
const olderEndUserId = '16cb273d-77e1-4d68-9eb1-77febdaee097'
const accountId = '56af1661-03ee-4995-b3c8-4ff981ba39f7'
const log: WorkflowAppLogPartialResponse = {
  id: 'log-1',
  created_at: 1794951000,
  created_by_end_user: {
    id: endUserId,
    type: 'service_api',
    is_anonymous: false,
    session_id: 'customer-001',
  },
}
const logs: WorkflowAppLogPartialResponse[] = [
  log,
  {
    ...log,
    id: 'log-2',
    created_by_end_user: null,
    created_by_account: { id: accountId, name: 'Mia Chen', email: 'mia@example.test' },
  },
]

const fake = setupFakeApi(() => {
  let task: WorkflowLogExportLatestTaskResponse | null = null
  return {
    console: {
      apps: {
        byAppId: {
          workflowAppLogs: {
            get: () => ({
              data: logs,
              total: logs.length,
              page: 1,
              limit: 10,
              has_more: false,
            }),
            identityOptions: {
              get: ({ query }) => ({
                data:
                  query.keyword === '042'
                    ? [{ id: olderEndUserId, label: 'customer-042', source: 'end-user' }]
                    : [],
              }),
            },
          },
          workflowLogExports: {
            preview: { get: ({ query }) => ({ row_count: query?.status === 'failed' ? 0 : 3 }) },
            post: ({ body: filters }) => {
              task = {
                task_id: taskId,
                status: 'pending',
                estimated_rows: filters.estimated_rows,
                identity_labels: filters.identity_labels ?? [],
                filters: {
                  created_at__after: filters.created_at__after ?? null,
                  created_at__before: filters.created_at__before ?? null,
                  end_user_ids: filters.end_user_ids ?? [],
                  account_ids: filters.account_ids ?? [],
                  status: filters.status ?? null,
                  keyword: null,
                },
              }
              return { task_id: taskId, status: 'pending', estimated_rows: task.estimated_rows }
            },
            latest: { get: () => ({ task }) },
            byTaskId: {
              get: ({ params }) => {
                expect(params.task_id).toBe(taskId)
                if (!task) throw new Error('The export must be created before reading its status')
                task = { ...task, status: 'ready' }
                return { task_id: taskId, status: 'ready', estimated_rows: task.estimated_rows }
              },
            },
          },
        },
      },
    },
  }
})

async function renderLogs({
  role = 'admin',
  sandbox = false,
}: {
  role?: 'admin' | 'editor'
  sandbox?: boolean
} = {}) {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    accountProfile: { timezone: 'UTC' },
    currentWorkspace: { role },
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { billing: { subscription: { plan: sandbox ? 'sandbox' : 'professional' } } },
  })
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const screen = await render(
    <ConsoleProvider>
      <UrlState>
        <Logs
          appDetail={createAppDetailFixture({
            id: appId,
            mode: 'workflow',
            name: 'Report Builder',
          })}
        />
      </UrlState>
    </ConsoleProvider>,
  )
  return screen
}

it('uses the Workflow list filters for CSV preview, restores the task, and downloads from the Workflow endpoint', async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-11-24T12:00:00Z'))
  onTestFinished(() => {
    vi.useRealTimers()
  })
  await page.viewport(1024, 800)
  const screen = await renderLogs()
  const { workflowAppLogs, workflowLogExports } = fake.console.apps.byAppId
  const latestListQuery = () => workflowAppLogs.get.mock.lastCall?.[0].query
  const latestPreviewQuery = () => workflowLogExports.preview.get.mock.lastCall?.[0].query
  await expect.element(screen.getByText('Mia Chen', { exact: true })).toBeVisible()
  await screen.getByRole('combobox', { name: 'appLog.filter.period.last7days' }).click()
  await page.getByRole('option', { name: 'appLog.filter.period.custom' }).click()
  await screen.getByRole('button', { name: /time\.picker\.startDate/ }).click()
  await page.getByRole('button', { name: /November 12th, 2026/ }).click()
  await screen.getByRole('button', { name: /time\.picker\.endDate/ }).click()
  await page.getByRole('button', { name: /November 23rd, 2026/ }).click()
  await expect.element(screen.getByText('Nov 12', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('Nov 23', { exact: true })).toBeVisible()
  await screen
    .getByRole('combobox', { name: 'appLog.table.header.status appLog.status.all' })
    .click()
  await page.getByRole('option', { name: 'appLog.status.succeeded' }).click()
  const identityLabel = 'appLog.table.header.endUser'
  await screen.getByRole('combobox', { name: identityLabel }).click()
  await page.getByRole('option', { name: 'Mia Chen' }).click()
  await page
    .getByRole('dialog', { name: identityLabel })
    .getByRole('combobox', { name: 'common.operation.search' })
    .fill('042')
  await page.getByRole('option', { name: 'customer-042' }).click()
  expect(latestListQuery()).not.toHaveProperty('account_ids')
  await page.getByText('appLog.workflowTitle', { exact: true }).click()
  await screen.getByRole('searchbox', { name: 'common.operation.search' }).fill('report')
  await expect.poll(() => latestListQuery()?.keyword).toBe('report')
  const listFilters = latestListQuery()
  expect(listFilters).toMatchObject({
    account_ids: [accountId],
    end_user_ids: [olderEndUserId],
    created_at__after: '2026-11-12T00:00:00Z',
    created_at__before: '2026-11-23T23:59:59.999999Z',
  })

  const trigger = screen.getByRole('button', { name: 'appLog.export.title' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'appLog.export.title' })
  const status = dialog.getByRole('combobox', { name: 'appLog.table.header.status' })
  await expect.element(status).toHaveTextContent('appLog.status.succeeded')
  await expect
    .element(dialog.getByText('appLog.export.previewWorkflowDescription', { exact: true }))
    .toBeVisible()
  expect(latestPreviewQuery()).toMatchObject({
    end_user_ids: [olderEndUserId],
    account_ids: [accountId],
    created_at__after: listFilters?.created_at__after,
    created_at__before: listFilters?.created_at__before,
  })
  expect(latestPreviewQuery()).not.toHaveProperty('keyword')
  expect(latestPreviewQuery()).not.toHaveProperty('page')

  await dialog.getByRole('button', { name: /time\.picker\.endDate/ }).click()
  await page.getByRole('button', { name: /November 24th, 2026/ }).click()
  const exportEnd = '2026-11-24T23:59:59.999999Z'
  await expect.poll(() => latestPreviewQuery()?.created_at__before).toBe(exportEnd)
  expect(latestListQuery()?.created_at__before).toBe(listFilters?.created_at__before)

  const submit = dialog.getByRole('button', { name: 'appLog.export.submit' })
  await status.click()
  await page.getByRole('option', { name: 'appLog.status.failed' }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('appLog.export.noMatches')
  await expect.element(submit).toBeDisabled()
  expect(latestListQuery()?.status).toBe('succeeded')
  await status.click()
  await page.getByRole('option', { name: 'appLog.status.succeeded' }).click()
  await expect.element(submit).toBeEnabled()
  await submit.click()
  await expect
    .poll(() => workflowLogExports.post.mock.calls.map(([{ body }]) => body))
    .toEqual([
      {
        status: 'succeeded',
        estimated_rows: 3,
        created_at__after: listFilters?.created_at__after,
        created_at__before: exportEnd,
        end_user_ids: [olderEndUserId],
        account_ids: [accountId],
        identity_labels: [
          { id: accountId, label: 'Mia Chen', source: 'account' },
          { id: olderEndUserId, label: 'customer-042', source: 'end-user' },
        ],
      },
    ])

  await expect.element(dialog).not.toBeInTheDocument()
  const progress = page.getByRole('dialog', { name: 'appLog.export.progressTitle' })
  await expect
    .element(progress.getByRole('button', { name: 'common.operation.download' }))
    .toBeEnabled()
  await progress.getByRole('button', { name: 'common.operation.close', exact: true }).last().click()
  await trigger.click()
  const last = dialog.getByRole('group', { name: 'appLog.export.last' })
  const download = last.getByRole('button', { name: 'common.operation.download' })
  await expect.element(download).toBeVisible()
  await expect.element(last.getByText(/appLog.status.succeeded/)).toBeVisible()
  await expect.element(last.getByText('customer-042, Mia Chen', { exact: true })).toBeVisible()
  const urls: string[] = []
  const followLink = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    urls.push(new URL(this.href).pathname)
  })
  onTestFinished(() => followLink.mockRestore())
  await download.click()
  expect(urls).toEqual([`/console/api/apps/${appId}/workflow-log-exports/${taskId}/file`])
})

it('shows the Cloud Sandbox upgrade to workspace managers and keeps the list filter available', async () => {
  const screen = await renderLogs({ sandbox: true })
  await expect
    .element(screen.getByRole('combobox', { name: 'appLog.table.header.endUser' }))
    .toBeVisible()
  await screen.getByRole('button', { name: 'appLog.export.title' }).click()
  await expect
    .element(page.getByRole('dialog', { name: 'appLog.export.upgradeTitle' }))
    .toBeVisible()
  const { workflowLogExports } = fake.console.apps.byAppId
  expect(workflowLogExports.preview.get).not.toHaveBeenCalled()
  expect(workflowLogExports.post).not.toHaveBeenCalled()
})

it('keeps the Workflow Logs identity filter available to editors', async () => {
  const screen = await renderLogs({ role: 'editor' })
  await expect
    .element(screen.getByRole('combobox', { name: 'appLog.table.header.endUser' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'appLog.export.title' }))
    .not.toBeInTheDocument()
})
