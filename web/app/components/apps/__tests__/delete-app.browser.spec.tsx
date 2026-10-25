import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { consoleClient } from '@/service/console'
import { zAppPagination } from '@dify/contracts/api/console/apps/zod.gen'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import appMessages from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import time from '@/i18n/locales/en-US/time.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import { List } from '../list'

const api = vi.hoisted(() => ({
  apps: vi.fn<typeof consoleClient.apps.get>(),
  starred: vi.fn<typeof consoleClient.apps.starred.get>(),
  delete: vi.fn<typeof consoleClient.apps.byAppId.delete>(),
}))
vi.mock('react-i18next', async (importOriginal) => importOriginal())
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/apps',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': api.apps,
      'apps.starred.get': api.starred,
      'apps.byAppId.delete': api.delete,
      'features.get': async () => zGetFeaturesResponse.parse({}),
      'tags.get': async () => [],
      'workspaces.current.members.get': async () => ({ accounts: [] }),
    }),
  }
})

const app = (id: string, name: string): AppPartial => ({
  ...createAppDetailFixture({ id, name, maintainer: 'user-1' }),
  permission_keys: [AppACLPermission.Delete],
})
const appPage = (data: AppPartial[]) =>
  zAppPagination.parse({ data, page: 1, limit: 30, has_more: false, total: data.length })
const animationSettings = globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
let previousAnimationSetting: boolean
beforeEach(() => {
  previousAnimationSetting = animationSettings.BASE_UI_ANIMATIONS_DISABLED
  animationSettings.BASE_UI_ANIMATIONS_DISABLED = false
})
afterEach(() => {
  animationSettings.BASE_UI_ANIMATIONS_DISABLED = previousAnimationSetting
})

async function setup(initialApps: AppPartial[], initialStarredApps: AppPartial[] = []) {
  await page.viewport(1024, 768)
  let apps = initialApps
  let starredApps = initialStarredApps
  api.apps.mockReset().mockImplementation(async () => appPage(apps))
  api.starred.mockReset().mockImplementation(async () => appPage(starredApps))
  api.delete.mockReset().mockImplementation(async ({ params }) => {
    apps = apps.filter(({ id }) => id !== params.app_id)
    starredApps = starredApps.filter(({ id }) => id !== params.app_id)
  })
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { app: appMessages, common, navigation, time } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
    features: {},
    systemFeatures: {
      rbac_enabled: true,
      enable_learn_app: false,
      enable_collaboration_mode: false,
    },
  })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <I18nextProvider i18n={i18n}>
          <div className="flex h-screen flex-col">
            <List />
          </div>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  await expect.element(screen.getByRole('list', { name: 'All Apps' })).toBeVisible()
  const actions = (listName: string, name: string) =>
    screen
      .getByRole('list', { name: listName })
      .getByRole('button', { name: `More actions for ${name}` })
  const openDelete = async (listName: string, name: string) => {
    await screen.getByRole('list', { name: listName }).getByRole('link', { name }).hover()
    await actions(listName, name).click()
    await expect.element(screen.getByRole('menu')).toBeVisible()
    const menu = screen.getByRole('menu').element()
    await screen.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.poll(() => menu.isConnected).toBe(false)
  }
  return { screen, queryClient, openDelete, actions }
}

it('keeps the delete dialog pending after its starred source unmounts until both app lists finish refreshing', async () => {
  const target = app('target', 'Shared App')
  const next = app('next', 'Next Starred App')
  const { screen, queryClient, openDelete, actions } = await setup([target, next], [target, next])
  const refresh = createDeferred<Awaited<ReturnType<typeof consoleClient.apps.get>>>()
  try {
    const starredLink = screen
      .getByRole('list', { name: 'Starred' })
      .getByRole('link', { name: target.name })
      .element()
    const catalogLink = screen
      .getByRole('list', { name: 'All Apps' })
      .getByRole('link', { name: target.name })
      .element()
    api.apps.mockReturnValueOnce(refresh.promise)
    await openDelete('Starred', target.name)
    const dialog = screen.getByRole('alertdialog').element()
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(() => starredLink.isConnected).toBe(false)
    expect(catalogLink.isConnected).toBe(true)
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    refresh.resolve(appPage([next]))
    await expect.poll(() => dialog.isConnected).toBe(false)
    await expect.poll(() => catalogLink.isConnected).toBe(false)
    await expect
      .element(screen.getByRole('list', { name: 'Starred' }).getByRole('link', { name: next.name }))
      .toHaveFocus()
    expect(api.delete).toHaveBeenCalledExactlyOnceWith({ params: { app_id: target.id } })
    await openDelete('Starred', next.name)
    const nextDialog = screen.getByRole('alertdialog').element()
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(() => nextDialog.isConnected).toBe(false)
    await expect.element(actions('Starred', next.name)).toHaveFocus()
  } finally {
    refresh.resolve(appPage([next]))
    queryClient.clear()
  }
})

it.each(['pointer', 'keyboard'] as const)(
  'restores the %s card action after cancellation and keeps it keyboard-operable',
  async (interaction) => {
    const target = app('target', 'Research App')
    const { screen, queryClient, actions } = await setup([target])
    try {
      const trigger = actions('All Apps', target.name)
      await expect.element(trigger).toBeInTheDocument()
      if (interaction === 'pointer') {
        await screen.getByRole('link', { name: target.name }).hover()
        await trigger.click()
      } else {
        trigger.element().focus()
        await userEvent.keyboard('{Enter}')
        await expect.element(screen.getByRole('menu')).toBeVisible()
        await userEvent.keyboard('{End}')
        await expect
          .element(screen.getByRole('menuitem', { name: 'Delete', exact: true }))
          .toHaveFocus()
      }
      await expect.element(screen.getByRole('menu')).toBeVisible()
      const menu = screen.getByRole('menu').element()
      if (interaction === 'pointer')
        await screen.getByRole('menuitem', { name: 'Delete', exact: true }).click()
      else await userEvent.keyboard('{Enter}')
      await expect.element(screen.getByRole('alertdialog')).toBeVisible()
      await expect.poll(() => menu.isConnected).toBe(false)
      await expect.element(screen.getByRole('textbox')).toHaveFocus()
      const dialog = screen.getByRole('alertdialog').element()
      await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect.poll(() => dialog.isConnected).toBe(false)
      await expect.element(trigger).toHaveFocus()
      await expect.element(trigger).toBeVisible()
      await userEvent.keyboard('{Enter}')
      await expect.element(screen.getByRole('menu')).toBeVisible()
      expect(api.delete).not.toHaveBeenCalled()
    } finally {
      queryClient.clear()
    }
  },
)

it('hands focus from the card context menu to deletion and restores the card link on cancel', async () => {
  const target = app('target', 'Research App')
  const { screen, queryClient } = await setup([target])
  try {
    const link = screen.getByRole('link', { name: target.name })
    await link.click({ button: 'right' })
    await expect.element(screen.getByRole('menu')).toBeVisible()
    const menu = screen.getByRole('menu').element()
    await screen.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.poll(() => menu.isConnected).toBe(false)
    await expect.element(screen.getByRole('textbox')).toHaveFocus()
    const dialog = screen.getByRole('alertdialog').element()
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(() => dialog.isConnected).toBe(false)
    await expect.element(link).toHaveFocus()
    expect(api.delete).not.toHaveBeenCalled()
  } finally {
    queryClient.clear()
  }
})

it('focuses the next card after deletion without moving the catalog scroll position', async () => {
  const apps = Array.from({ length: 30 }, (_, index) => app(`app-${index}`, `App ${index}`))
  const target = apps[15]!
  const { screen, queryClient, openDelete } = await setup(apps)
  try {
    const viewport = screen.getByRole('region', { name: 'Studio', exact: true })
    const element = viewport.element()
    await expect.poll(() => element.scrollHeight).toBeGreaterThan(element.clientHeight)
    element.scrollTo({ top: 600 })
    await expect.poll(() => element.scrollTop).toBeGreaterThan(0)
    await openDelete('All Apps', target.name)
    const scrollTopBefore = element.scrollTop
    const dialog = screen.getByRole('alertdialog').element()
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(() => dialog.isConnected).toBe(false)
    await expect
      .element(screen.getByRole('link', { name: target.name, exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: apps[16]!.name, exact: true }))
      .toHaveFocus()
    expect(element.scrollTop).toBe(scrollTopBefore)
    expect(element.scrollTop).toBeGreaterThan(0)
  } finally {
    queryClient.clear()
  }
})

it('returns focus to the empty catalog when its last app is deleted without an exit transition', async () => {
  const target = app('last', 'Last App')
  const { screen, queryClient, openDelete } = await setup([target])
  const noMotionStyle = document.createElement('style')
  try {
    noMotionStyle.textContent =
      '[role="alertdialog"] { transition: none !important; animation: none !important; }'
    document.head.append(noMotionStyle)
    await openDelete('All Apps', target.name)
    const dialog = screen.getByRole('alertdialog').element()
    expect(getComputedStyle(dialog).transitionDuration).toBe('0s')
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(() => dialog.isConnected).toBe(false)
    await expect.element(screen.getByRole('link', { name: target.name })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('region', { name: 'Studio', exact: true })).toHaveFocus()
  } finally {
    noMotionStyle.remove()
    queryClient.clear()
  }
})

it.each([
  { deleted: 1, focused: 2 },
  { deleted: 2, focused: 1 },
])('focuses card $focused after deleting card $deleted', async ({ deleted, focused }) => {
  const apps = [app('a', 'First App'), app('b', 'Middle App'), app('c', 'Last App')]
  const { screen, queryClient, openDelete } = await setup(apps)
  try {
    await openDelete('All Apps', apps[deleted]!.name)
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: apps[deleted]!.name }))
      .not.toBeInTheDocument()
    const target = screen.getByRole('link', { name: apps[focused]!.name })
    await expect.element(target).toHaveFocus()
    await expect.element(target).toBeVisible()
    await userEvent.keyboard('{Tab}')
    await expect
      .element(screen.getByRole('button', { name: `Star app: ${apps[focused]!.name}` }))
      .toHaveFocus()
  } finally {
    queryClient.clear()
  }
})

it('falls back to the viewport when the source starred section disappears', async () => {
  const target = app('target', 'Only Starred App')
  const remaining = app('remaining', 'Unstarred App')
  const { screen, queryClient, openDelete } = await setup([target, remaining], [target])
  try {
    await openDelete('Starred', target.name)
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('list', { name: 'Starred' })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: remaining.name })).toBeVisible()
    await expect.element(screen.getByRole('region', { name: 'Studio', exact: true })).toHaveFocus()
  } finally {
    queryClient.clear()
  }
})

it('focuses the next card primary control when that card has no actions', async () => {
  const target = app('target', 'Editable App')
  const remaining = {
    ...app('remaining', 'Preview App'),
    permission_keys: [AppACLPermission.Preview],
  }
  const { screen, queryClient, openDelete } = await setup([target, remaining])
  try {
    await openDelete('All Apps', target.name)
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: remaining.name, exact: true }))
      .toHaveFocus()
  } finally {
    queryClient.clear()
  }
})
