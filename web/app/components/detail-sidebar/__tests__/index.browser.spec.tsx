import type { ReactNode } from 'react'
import type { DetailSidebarMode } from '../cookie'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { useHydrateAtoms } from 'jotai/utils'
import Cookies from 'js-cookie'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import { DetailSidebarFrame } from '..'
import { DETAIL_SIDEBAR_COOKIE_NAME } from '../cookie'
import { detailSidebarModeAtom } from '../state'

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

vi.mock('@/app/components/main-nav/components/account-section', () => ({
  default: ({ compact }: { compact?: boolean }) => (
    <button type="button" aria-label="account">
      {compact ? 'Compact account' : 'Expanded account'}
    </button>
  ),
}))

vi.mock('@/app/components/main-nav/components/help-menu', () => ({
  default: () => (
    <button type="button" aria-label="help">
      Help
    </button>
  ),
}))

vi.mock('@/app/components/header/env-nav', () => ({ default: () => <div>Environment tag</div> }))

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
}: {
  currentEnv?: string | null
  mode?: DetailSidebarMode
  width?: number
} = {}) {
  await page.viewport(width, 720)
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient, {}, { currentEnv })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
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
    </QueryClientTestProvider>,
  )
  return screen
}

beforeEach(() => {
  window.history.replaceState({}, '', '/app/app-1/overview')
  Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME)
})

afterEach(() => Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME))

it('uses the native shortcut outside editors and persists the resulting preference', async () => {
  const screen = await renderSidebar({ currentEnv: 'TESTING' })
  await expect.element(screen.getByText('Expanded content')).toBeVisible()
  await expect.element(screen.getByText('Environment tag')).toBeVisible()

  await userEvent.keyboard('{Meta>}b{/Meta}')
  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  await expect.element(screen.getByText('Environment tag')).not.toBeInTheDocument()
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')

  await userEvent.click(screen.getByRole('textbox', { name: 'Name' }))
  await userEvent.keyboard('{Meta>}b{/Meta}')
  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')
})

it('uses the real compact viewport without overwriting the desktop preference', async () => {
  const screen = await renderSidebar({ width: 640 })
  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'account' }))
    .toHaveTextContent('Compact account')

  await userEvent.click(screen.getByRole('button', { name: 'Toggle detail' }))
  await expect.element(screen.getByText('Expanded content')).toBeVisible()
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBeUndefined()

  window.history.pushState({}, '', '/app/app-1/logs')
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBeUndefined()
})

// TODO(issue): the preview is painted but the following main content wins native hit testing.
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

  await screen.getByRole('button', { name: 'help' }).hover()

  await expect.element(screen.getByText('Collapsed content')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'account' }))
    .toHaveTextContent('Compact account')
})
