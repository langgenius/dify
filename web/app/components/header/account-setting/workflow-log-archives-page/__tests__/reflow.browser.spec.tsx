import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { ACCOUNT_SETTING_TAB } from '../../constants'
import AccountSetting from '../../index'

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

it('keeps the complete empty message readable without horizontal scrolling at 320 CSS pixels', async () => {
  // The real Settings shell supplies the available width; happy-dom cannot detect clipped text.
  await page.viewport(320, 800)
  const { queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    features: { billing: { subscription: { plan: 'team' } } },
    systemFeatures: { deployment_edition: 'CLOUD', rbac_enabled: false },
  })
  queryClient.setQueryData(consoleQuery.workflowRunArchives.get.queryKey(), {
    months: [],
    summary: {
      archived_month_count: 0,
      workflow_run_count: 0,
      archive_bytes: 0,
      latest_archived_at: null,
    },
  })

  try {
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
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
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
