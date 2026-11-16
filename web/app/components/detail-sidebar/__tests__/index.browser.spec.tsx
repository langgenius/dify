import type { ReactNode } from 'react'
import type { DetailSidebarMode } from '../cookie'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { useHydrateAtoms } from 'jotai/utils'
import Cookies from 'js-cookie'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ThemeProvider } from '@/features/theme/provider'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import { DetailSidebarFrame } from '..'
import { DETAIL_SIDEBAR_COOKIE_NAME } from '../cookie'
import { detailSidebarModeAtom } from '../state'

const boundary = vi.hoisted(() => ({ openZendesk: vi.fn() }))

// boundary: Zendesk loads a third-party widget outside the test page.
vi.mock('@/app/components/base/zendesk/runtime', () => ({
  zendeskRuntime: { open: boundary.openZendesk },
}))

// boundary: the widget key is supplied by the deployment environment.
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ZENDESK_WIDGET_KEY: 'zendesk-key',
}))

// boundary: Next's app router is unavailable in the standalone Vitest browser page.
vi.mock('@/next/navigation', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (notify: () => void) => {
    window.addEventListener('popstate', notify)
    return () => window.removeEventListener('popstate', notify)
  }
  return {
    usePathname: () =>
      useSyncExternalStore(
        subscribe,
        () => window.location.pathname,
        () => window.location.pathname,
      ),
  }
})

function InitialDetailSidebarMode({
  children,
  mode,
}: {
  children: ReactNode
  mode: DetailSidebarMode
}) {
  useHydrateAtoms([[detailSidebarModeAtom, mode]])
  return children
}

async function renderSidebar({
  currentEnv = null,
  mode = 'expand',
  width = 1024,
  plan,
}: {
  currentEnv?: string | null
  mode?: DetailSidebarMode
  width?: number
  plan?: 'team' | 'sandbox'
} = {}) {
  await page.viewport(width, 720)
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient, {}, { currentEnv })
  seedCurrentWorkspaceQuery(queryClient)
  seedSystemFeatures(queryClient, { deployment_edition: plan ? 'CLOUD' : 'COMMUNITY' })
  if (plan) seedFeatures(queryClient, { billing: { subscription: { plan } } })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <ThemeProvider defaultPreference="light">
          <InitialDetailSidebarMode mode={mode}>
            <HotkeysProvider defaultOptions={{ hotkey: { platform: 'mac' } }}>
              <div className="flex h-[720px]">
                <DetailSidebarFrame
                  renderTop={({ expand, onToggle }) => (
                    <header aria-label="Detail sidebar">
                      <span>{expand ? 'Expanded detail' : 'Collapsed detail'}</span>
                      <button type="button" onClick={onToggle}>
                        Toggle detail
                      </button>
                    </header>
                  )}
                  renderSection={({ expand }) => (
                    <section aria-label="Detail content">
                      {expand ? 'Expanded content' : 'Collapsed content'}
                    </section>
                  )}
                />
                <main className="flex flex-1 flex-col items-start gap-2 p-4">
                  <input aria-label="Name" />
                  <button type="button">Outside sidebar</button>
                </main>
              </div>
            </HotkeysProvider>
          </InitialDetailSidebarMode>
        </ThemeProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  return screen
}

beforeEach(() => {
  vi.clearAllMocks()
  boundary.openZendesk.mockResolvedValue(undefined)
  window.history.replaceState({}, '', '/app/app-1/overview')
  Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME)
})

afterEach(() => Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME))

it('opens paid Cloud support from expanded and collapsed detail sidebars', async () => {
  const screen = await renderSidebar({ plan: 'team' })
  const contact = screen.getByRole('button', { name: 'common.userProfile.contactSupport' })

  await expect.element(contact).toBeVisible()
  await userEvent.click(contact)
  expect(boundary.openZendesk).toHaveBeenCalledWith('CLOUD')

  await userEvent.click(screen.getByRole('button', { name: 'Toggle detail' }))
  await expect.element(screen.getByText('Collapsed detail')).toBeVisible()
  await expect.element(contact).toBeVisible()
  await userEvent.click(contact)
  expect(boundary.openZendesk).toHaveBeenCalledTimes(2)
})

it('uses the native shortcut outside editors and persists the resulting preference', async () => {
  const screen = await renderSidebar({ currentEnv: 'TESTING' })
  await expect.element(screen.getByText('Expanded content')).toBeVisible()
  await expect.element(screen.getByText('common.environment.testing')).toBeVisible()

  await userEvent.keyboard('{Meta>}b{/Meta}')
  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  await expect.element(screen.getByText('common.environment.testing')).not.toBeInTheDocument()
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')

  await userEvent.click(screen.getByRole('textbox', { name: 'Name' }))
  await userEvent.keyboard('{Meta>}b{/Meta}')
  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')
})

it('uses the real compact viewport without overwriting the desktop preference', async () => {
  const screen = await renderSidebar({ width: 640 })
  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  await expect.element(screen.getByTitle('Test User')).toBeVisible()
  await expect.element(screen.getByText('T')).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Toggle detail' }))
  await expect.element(screen.getByText('Expanded content')).toBeVisible()
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBeUndefined()

  window.history.pushState({}, '', '/app/app-1/logs')
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBeUndefined()
})

// TODO(https://github.com/langgenius/dify/issues/45933): the following main content wins native hit testing.
it.fails('keeps the hovered preview actionable without persisting it', async () => {
  const screen = await renderSidebar({ mode: 'collapse' })
  const toggle = screen.getByRole('button', { name: 'Toggle detail' })
  await expect.element(screen.getByText('Collapsed content')).toBeVisible()

  await toggle.hover()
  await expect.element(screen.getByText('Expanded content')).toBeVisible()
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBeUndefined()

  const element = toggle.element()
  const bounds = element.getBoundingClientRect()
  const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  expect(element.contains(hit)).toBe(true)
})

it('does not turn collapsed bottom actions into a detail preview', async () => {
  const screen = await renderSidebar({ mode: 'collapse' })

  await screen.getByRole('button', { name: 'navigation.mainNav.help.openMenu' }).hover()

  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  await expect.element(screen.getByTitle('Test User')).toBeVisible()
  await expect.element(screen.getByText('T')).toBeVisible()
})
