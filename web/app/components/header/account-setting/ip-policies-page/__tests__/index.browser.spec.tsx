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
import { installFakeApi } from '@/test/fake-api'
import { ACCOUNT_SETTING_TAB } from '../../constants'
import AccountSetting from '../../index'

vi.unmock('react-i18next')

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
    createNetworkAccessGroupFixture({
      id: '1f9a3c2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
      name: 'Internal Network',
      used_by_count: 2,
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }),
    createNetworkAccessGroupFixture({
      id: '2a8b4d3f-6c8e-4f9a-8b1c-2d3e4f5a6b7c',
      name: 'Engineering Office',
      allowed_cidrs: ['192.0.2.0/24'],
      updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  ]
  const fake = installFakeApi({
    console: {
      workspaces: {
        current: {
          networkAccessGroups: {
            get: () => ({ tenant_id: 'workspace-1', entitled: true, groups }),
            currentIp: { get: () => ({ client_ip: '203.0.113.42' }) },
            byGroupId: { delete: () => ({ deleted: true }) },
          },
        },
      },
    },
  })
  onTestFinished(fake)
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
  return { screen, queryClient, groups, fake }
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
    const updatedLabels = ['2 hours ago', '3 days ago']
    for (const [index, group] of groups.entries()) {
      const cells = table
        .getByRole('row')
        .nth(index + 1)
        .getByRole('cell')
      await expect.element(cells.nth(0)).toHaveTextContent(group.name)
      await expect.element(cells.nth(1)).toHaveTextContent(String(group.allowed_cidrs.length))
      await expect.element(cells.nth(2)).toHaveTextContent(`${group.used_by_count} apps`)
      await expect.element(cells.nth(3)).toHaveTextContent(updatedLabels[index]!)
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

it('restores edit focus to the opener or the heading if its row disappears', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  try {
    const { screen, queryClient, groups } = await renderPoliciesSettings(1000)
    const more = screen.getByRole('button', { name: 'More actions for Internal Network' })
    await more.click()
    await screen.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    const editor = screen.getByRole('dialog', { name: 'Edit IP Policy' })
    await expect.element(editor.getByRole('button', { name: 'Close', exact: true })).toHaveFocus()
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await expect.element(more).toHaveFocus()

    await screen.getByRole('button', { name: 'Internal Network', exact: true }).click()
    await expect.element(editor).toBeVisible()
    seedNetworkAccessGroups(queryClient, { groups: groups.slice(1) })
    await userEvent.keyboard('{Escape}')
    await expect.element(editor).not.toBeInTheDocument()
    await expect.element(screen.getByRole('heading', { name: 'IP Policies' })).toHaveFocus()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('confirms using the latest policy details and focuses the list after deleting the row', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  try {
    const { screen, queryClient, groups, fake } = await renderPoliciesSettings(1000)
    const policies = fake.console.workspaces.current.networkAccessGroups
    let remainingGroups = groups
    policies.get.mockImplementation(() => ({
      tenant_id: 'workspace-1',
      entitled: true,
      groups: remainingGroups,
    }))
    policies.byGroupId.delete.mockImplementation(() => {
      remainingGroups = groups.slice(1)
      return { deleted: true }
    })

    await screen.getByRole('button', { name: 'More actions for Internal Network' }).click()
    await screen.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    const confirmation = screen.getByRole('alertdialog', { name: 'Delete “Internal Network”?' })
    await expect
      .element(confirmation.getByText(common['settings.ipPolicyDeleteBoundDescription']))
      .toBeVisible()
    const refreshedPolicy = { ...groups[0]!, version: 7, used_by_count: 0 }
    remainingGroups = [refreshedPolicy, ...groups.slice(1)]
    seedNetworkAccessGroups(queryClient, { groups: remainingGroups })
    await expect
      .element(confirmation.getByText(common['settings.ipPolicyDeleteDescription']))
      .toBeVisible()
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect
      .poll(() => policies.byGroupId.delete)
      .toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          params: { group_id: refreshedPolicy.id },
          query: { expected_version: 7 },
        }),
      )
    await expect
      .element(screen.getByRole('button', { name: 'Internal Network', exact: true }))
      .not.toBeInTheDocument()
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('heading', { name: 'IP Policies', exact: true }))
      .toHaveFocus()
  } finally {
    vi.unstubAllGlobals()
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
