import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createNetworkAccessGroupFixture,
  seedNetworkAccessGroups,
} from '@/test/console/network-access'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { ACCOUNT_SETTING_TAB } from '../../constants'
import AccountSetting from '../../index'

const request = vi.hoisted(() => vi.fn<(path: string) => unknown>())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: readonly string[]) => request(path.join('.')),
  },
}))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => 'en-US',
}))
vi.mock('@/i18n/client', () => ({ setLocaleOnClient: vi.fn().mockResolvedValue(undefined) }))
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const namespaces = {
    accountSettings: (await import('@/i18n/locales/en-US/account-settings.json')).default,
    common: (await import('@/i18n/locales/en-US/common.json')).default,
    navigation: (await import('@/i18n/locales/en-US/navigation.json')).default,
    deployments: (await import('@/i18n/locales/en-US/deployments.json')).default,
  }
  const translations = Object.fromEntries(
    Object.entries(namespaces).flatMap(([namespace, messages]) =>
      Object.entries(messages).map(([key, value]) => [`${namespace}.${key}`, value]),
    ),
  )
  return { ...actual, ...createReactI18nextMock(translations) }
})

async function renderPoliciesSettings(width = 320) {
  await page.viewport(width, 800)
  const { queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner', plan: 'team' },
    accountProfile: { timezone: 'Asia/Shanghai', interface_language: 'en-US' },
    systemFeatures: { deployment_edition: 'CLOUD', rbac_enabled: false },
  })
  const groups = [
    createNetworkAccessGroupFixture({ name: 'Internal Network', used_by_count: 2 }),
    createNetworkAccessGroupFixture({
      id: 'group-2',
      name: 'Engineering Office',
      allowed_cidrs: ['192.0.2.0/24'],
    }),
  ]
  seedNetworkAccessGroups(queryClient, { groups })
  request.mockImplementation((path) => {
    if (path === 'workspaces.current.networkAccessGroups.get')
      return { tenant_id: 'workspace-1', entitled: true, groups }
    if (path === 'workspaces.current.networkAccessGroups.currentIp.get')
      return { client_ip: '203.0.113.42' }
    throw new Error(`Unexpected console request: ${path}`)
  })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <AccountSetting
          activeTab={ACCOUNT_SETTING_TAB.IP_POLICIES}
          onCancelAction={vi.fn()}
          onTabChangeAction={vi.fn()}
        />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  await expect.element(screen.getByRole('table', { name: 'IP Policies' })).toBeVisible()
  return { screen, queryClient, groups }
}

async function expectReadableText(content: Element, viewport: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(content)
  const text = range.getBoundingClientRect()
  const bounds = viewport.getBoundingClientRect()
  const delta =
    text.left < bounds.left
      ? text.left - bounds.left - 1
      : text.right > bounds.right
        ? text.right - bounds.right + 1
        : 0
  if (delta !== 0) {
    const previous = viewport.scrollLeft
    await page.elementLocator(viewport).wheel({ delta: { x: delta, y: 0 } })
    await expect.poll(() => viewport.scrollLeft).not.toBe(previous)
  }
  await expect
    .poll(
      () => {
        const visible = viewport.getBoundingClientRect()
        const fragments = Array.from(range.getClientRects())
        return (
          fragments.length > 0 &&
          fragments.every(
            (fragment) =>
              fragment.width > 0 &&
              fragment.left >= visible.left - 1 &&
              fragment.right <= visible.right + 1,
          )
        )
      },
      { message: `Full text must be readable: ${content.textContent}` },
    )
    .toBe(true)
}

it('keeps policy data readable and keyboard scrollable inside Settings at 320 px', async () => {
  // Unit tests miss columns clipped by Settings and native focus, arrow-key and wheel scrolling.
  const { screen, queryClient, groups } = await renderPoliciesSettings()
  try {
    const add = screen.getByRole('button', { name: 'Add', exact: true })
    const region = screen.getByRole('region', { name: 'IP Policies', exact: true })
    const table = screen.getByRole('table', { name: 'IP Policies', exact: true })
    add.element().focus()
    await expect.element(add).toHaveFocus()
    await userEvent.tab()
    await expect.element(region).toHaveFocus()
    expect(region.element().matches(':focus-visible')).toBe(true)
    const viewport = region.element() as HTMLElement
    const initial = viewport.scrollLeft
    const keyboardScrollEnd = new Promise<void>((resolve) =>
      viewport.addEventListener('scrollend', () => resolve(), { once: true }),
    )
    await userEvent.keyboard('{ArrowRight}')
    await keyboardScrollEnd
    await expect.poll(() => viewport.scrollLeft).toBeGreaterThan(initial)

    for (const name of ['Name', 'IP Entries', 'Used by', 'Updated at'])
      await expectReadableText(
        table.getByRole('columnheader', { name, exact: true }).element(),
        viewport,
      )
    for (const [index, group] of groups.entries()) {
      const cells = table
        .getByRole('row')
        .nth(index + 1)
        .getByRole('cell')
      await expect.element(cells.nth(0)).toHaveTextContent(group.name)
      await expect.element(cells.nth(1)).toHaveTextContent(String(group.allowed_cidrs.length))
      await expect.element(cells.nth(2)).toHaveTextContent(`${group.used_by_count} apps`)
      expect(cells.nth(3).element().textContent?.trim()).toBeTruthy()
      for (let column = 0; column < 4; column++)
        await expectReadableText(cells.nth(column).element(), viewport)
    }
    const more = screen.getByRole('button', {
      name: 'More actions for Internal Network',
      exact: true,
    })
    await more.click()
    await expect.element(screen.getByRole('menuitem', { name: 'Edit', exact: true })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(more).toHaveFocus()
  } finally {
    await screen.unmount()
    queryClient.clear()
  }
})
