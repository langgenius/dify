import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { ACCOUNT_SETTING_TAB } from '../constants'
import AccountSetting from '../index'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const namespaces = {
    billing: (await import('@/i18n/locales/en-US/billing.json')).default,
    common: (await import('@/i18n/locales/en-US/common.json')).default,
    navigation: (await import('@/i18n/locales/en-US/navigation.json')).default,
    custom: (await import('@/i18n/locales/en-US/custom.json')).default,
  }
  const translations = Object.fromEntries(
    Object.entries(namespaces).flatMap(([namespace, messages]) =>
      Object.entries(messages).map(([key, value]) => [`${namespace}.${key}`, value]),
    ),
  )
  return { ...actual, ...createReactI18nextMock(translations) }
})

const unexpectedFetch = vi.fn(() => Promise.reject(new Error('Unexpected request')))
beforeEach(() => vi.stubGlobal('fetch', unexpectedFetch))
afterEach(() => {
  expect(unexpectedFetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

export async function renderBillingSettings() {
  await page.viewport(320, 800)
  const { queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'normal' },
    workspacePermissionKeys: [],
    features: { billing: { subscription: { plan: 'team' } } },
    systemFeatures: { deployment_edition: 'CLOUD', rbac_enabled: false },
  })
  queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryOptions().queryKey, {
    size: 60,
    limit: 1024,
    usage_unknown: false,
  })

  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <AccountSetting
          activeTab={ACCOUNT_SETTING_TAB.BILLING}
          onCancelAction={vi.fn()}
          onTabChangeAction={vi.fn()}
        />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  const dialog = screen.getByRole('dialog', { name: 'Settings' })
  const viewPlan = dialog.getByRole('button', { name: 'View Plan' })
  const preferences = dialog.getByRole('button', { name: 'Preferences' })
  await expect.element(viewPlan).toBeInTheDocument()
  await expect.element(dialog.getByRole('button', { name: 'Close' })).toHaveFocus()

  // A regular member sees these destinations before the scrollable panel.
  for (const name of ['Members', 'Billing', 'Customization', 'Preferences']) {
    await userEvent.tab()
    await expect.element(dialog.getByRole('button', { name })).toHaveFocus()
  }
  await userEvent.tab()

  const viewport = document.activeElement
  expect(viewport).toBeInstanceOf(HTMLElement)
  const scrollable = viewport as HTMLElement
  expect(scrollable.scrollHeight).toBeGreaterThan(scrollable.clientHeight)
  expect(scrollable.contains(viewPlan.element())).toBe(true)

  return { dialog, preferences, viewPlan, viewport: scrollable }
}
