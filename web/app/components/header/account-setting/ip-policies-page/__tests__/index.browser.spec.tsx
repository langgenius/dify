import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import accountSettings from '@/i18n/locales/en-US/account-settings.json'
import common from '@/i18n/locales/en-US/common.json'
import deployments from '@/i18n/locales/en-US/deployments.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import {
  createNetworkAccessGroupFixture,
  seedNetworkAccessGroups,
} from '@/test/console/network-access'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { ACCOUNT_SETTING_TAB } from '../../constants'
import AccountSetting from '../../index'

vi.unmock('react-i18next')

const request = vi.hoisted(() => vi.fn<(path: string) => unknown>())

// boundary: IP-policy reads and writes stop at the generated console transport.
vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: readonly string[]) => request(path.join('.')),
  },
}))
// boundary: analytics must not emit product telemetry from a browser test.
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))
// boundary: Next's app router is unavailable in the standalone Vitest browser page.
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/account/settings',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))
// boundary: next-themes requires a Next document and persisted browser theme outside this journey.
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))

async function renderPoliciesSettings(width = 320) {
  await page.viewport(width, 800)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { accountSettings, common, navigation, deployments } },
  })
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
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter>
          <AccountSetting
            activeTab={ACCOUNT_SETTING_TAB.IP_POLICIES}
            onCancelAction={vi.fn()}
            onTabChangeAction={vi.fn()}
          />
        </NuqsTestingAdapter>
      </I18nextProvider>
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

it('keeps Add clear of Settings Close at 320 px and preserves the desktop action order', async () => {
  // Real hit testing catches the global Close overlay; the desktop order must survive reflow.
  const { screen, queryClient } = await renderPoliciesSettings()
  try {
    const settings = screen.getByRole('dialog', { name: 'Settings', exact: true })
    const add = settings.getByRole('button', { name: 'Add', exact: true })
    const close = settings.getByRole('button', { name: 'Close', exact: true })
    const bounds = add.element().getBoundingClientRect()
    const other = close.element().getBoundingClientRect()
    const overlap =
      Math.max(0, Math.min(bounds.right, other.right) - Math.max(bounds.left, other.left)) *
      Math.max(0, Math.min(bounds.bottom, other.bottom) - Math.max(bounds.top, other.top))
    expect(overlap, 'Add must not sit beneath the global Close button').toBe(0)
    await add.click()
    const editor = screen.getByRole('dialog', { name: 'New IP Policy', exact: true })
    await expect.element(editor).toBeVisible()
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.element(editor).not.toBeInTheDocument()
    await expect.element(add).toHaveFocus()

    await page.viewport(1280, 800)
    await expect
      .element(settings.getByRole('region', { name: 'IP Policies', exact: true }))
      .toHaveAttribute('tabindex', '-1')
    const order = [
      settings.getByRole('button', { name: 'Internal Network', exact: true }),
      settings.getByRole('button', { name: 'More actions for Internal Network', exact: true }),
      settings.getByRole('button', { name: 'Engineering Office', exact: true }),
      settings.getByRole('button', { name: 'More actions for Engineering Office', exact: true }),
      close,
    ]
    for (const target of order) {
      await userEvent.tab()
      await expect.element(target).toHaveFocus()
    }
  } finally {
    await screen.unmount()
    queryClient.clear()
  }
})
