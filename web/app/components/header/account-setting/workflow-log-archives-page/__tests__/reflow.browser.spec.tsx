import type { GetWorkflowRunArchivesResponse } from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { ACCOUNT_SETTING_TAB } from '../../constants'
import AccountSetting from '../../index'

const archiveListRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: readonly string[], input: unknown) => {
      if (path.join('.') === 'workflowRunArchives.get') return archiveListRequest(input)
      throw new Error(`Unexpected console request: ${path.join('.')}`)
    },
  },
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const namespaces = {
    appLog: (await import('@/i18n/locales/en-US/app-log.json')).default,
    common: (await import('@/i18n/locales/en-US/common.json')).default,
    navigation: (await import('@/i18n/locales/en-US/navigation.json')).default,
  }
  const translations = Object.fromEntries(
    Object.entries(namespaces).flatMap(([namespace, messages]) =>
      Object.entries(messages).map(([key, value]) => [`${namespace}.${key}`, value]),
    ),
  )
  return { ...actual, ...createReactI18nextMock(translations) }
})

async function renderSettings(archives: GetWorkflowRunArchivesResponse) {
  await page.viewport(320, 800)
  const { queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    features: { billing: { subscription: { plan: 'team' } } },
    systemFeatures: { deployment_edition: 'CLOUD', rbac_enabled: false },
  })
  queryClient.setQueryData(consoleQuery.workflowRunArchives.get.queryKey(), archives)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <AccountSetting
          activeTab={ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES}
          onCancelAction={vi.fn()}
          onTabChangeAction={vi.fn()}
        />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  return { dialog: screen.getByRole('dialog', { name: 'Settings' }), queryClient }
}

it('keeps the complete empty message readable without horizontal scrolling at 320 CSS pixels', async () => {
  // The real Settings shell supplies the available width; happy-dom cannot detect clipped text.
  const { dialog, queryClient } = await renderSettings({
    months: [],
    summary: {
      archived_month_count: 0,
      workflow_run_count: 0,
      archive_bytes: 0,
      latest_archived_at: null,
    },
  })

  try {
    const title = dialog.getByText('No archived logs')
    const description = dialog.getByText(
      'Archived workflow run logs will appear here after the retention job finishes.',
    )
    await expect.element(description).toBeVisible()
    for (const message of [title, description]) {
      const rect = message.element().getBoundingClientRect()
      expect(rect.left).toBeGreaterThanOrEqual(0)
      expect(rect.right).toBeLessThanOrEqual(320)
    }
    expect(description.element().clientWidth).toBeGreaterThanOrEqual(
      description.element().scrollWidth,
    )
  } finally {
    queryClient.clear()
  }
})

it('keeps a refresh error above retained rows and readable while scrolling a narrow table', async () => {
  const { dialog, queryClient } = await renderSettings({
    summary: {
      archived_month_count: 1,
      workflow_run_count: 125,
      archive_bytes: 1048576,
      latest_archived_at: '2025-03-03T00:00:00Z',
    },
    months: [
      {
        year: 2025,
        month: 3,
        workflow_run_count: 125,
        row_count: 1125,
        archive_bytes: 1048576,
        bundle_count: 2,
        latest_archived_at: '2025-03-03T00:00:00Z',
        download_task: null,
        deletion_status: null,
      },
    ],
  })

  try {
    archiveListRequest.mockRejectedValue(new Error('Archives unavailable'))
    await queryClient.refetchQueries({ queryKey: consoleQuery.workflowRunArchives.get.queryKey() })
    const title = dialog.getByText('Could not load archived logs')
    const description = dialog.getByText('Refresh the page or try again later.')
    await expect.element(title).toBeVisible()
    const header = dialog.getByRole('row', { name: /^month runs size action$/i })
    const row = dialog.getByRole('row', { name: /2025-03/ })
    const table = dialog.getByRole('table')
    const tableLeft = table.element().getBoundingClientRect().left
    expect(title.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      header.element().getBoundingClientRect().bottom,
    )
    expect(description.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      row.element().getBoundingClientRect().top,
    )
    const expectReadable = () => {
      for (const message of [title, description]) {
        const element = message.element()
        const rect = element.getBoundingClientRect()
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.right).toBeLessThanOrEqual(320)
        expect(element.clientWidth).toBeGreaterThanOrEqual(element.scrollWidth)
      }
    }
    expectReadable()

    const download = row.getByRole('button', { name: 'Prepare download 2025-03' })
    for (let index = 0; index < 12 && document.activeElement !== download.element(); index++) {
      await userEvent.tab()
    }
    await expect.element(download).toHaveFocus()
    expect(table.element().getBoundingClientRect().left).toBeLessThan(tableLeft)
    expectReadable()
  } finally {
    queryClient.clear()
  }
})
