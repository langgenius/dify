import type { ChatWithHistoryContextValue } from '@/app/components/base/chat/chat-with-history/context'
import type { SiteInfo } from '@/models/share'
import { QueryClient } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  ChatWithHistoryContext,
  useChatWithHistoryContext,
} from '@/app/components/base/chat/chat-with-history/context'
import Sidebar from '@/app/components/base/chat/chat-with-history/sidebar'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import MenuDropdown from '../menu-dropdown'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/chat/test-app',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

const site: SiteInfo = {
  title: 'Team assistant',
  description: 'An assistant for daily work.',
  icon_type: 'emoji',
  icon: '😀',
  copyright: 'Example team',
}
const clients: QueryClient[] = []
const ChatHistoryProvider = ChatWithHistoryContext.Provider

function ConversationOwner({ rename }: { rename: (id: string, name: string) => Promise<void> }) {
  const defaults = useChatWithHistoryContext()
  const [name, setName] = useState('Saved conversation')
  const [pending, setPending] = useState(false)
  const value: ChatWithHistoryContextValue = {
    ...defaults,
    appData: { app_id: 'test-app', site, custom_config: null },
    conversationList: [{ id: 'saved', name, inputs: {}, introduction: '' }],
    conversationRenaming: pending,
    handleRenameConversation: async (id, nextName, callback) => {
      setPending(true)
      try {
        await rename(id, nextName)
        setName(nextName)
        callback.onSuccess?.()
      } finally {
        setPending(false)
      }
    },
  }
  return (
    <ChatHistoryProvider value={value}>
      <Sidebar />
    </ChatHistoryProvider>
  )
}

beforeEach(async () => {
  await page.viewport(1280, 900)
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.unstubAllGlobals()
})

it('opens About directly from the real menu and keeps its Close reachable on a narrow screen', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  await page.viewport(360, 640)
  const screen = await render(
    <ThemeProvider>
      <MenuDropdown data={site} hideLogout />
    </ThemeProvider>,
  )
  const more = screen.getByRole('button', { name: 'common.operation.more' })
  await userEvent.tab()
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'common.userProfile.about' }))
    .toBeVisible()
  await userEvent.keyboard('{End}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'common.userProfile.about' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: site.title })
  await expect.element(dialog).toBeVisible()
  await expect.element(dialog).toHaveAccessibleDescription(site.description!)
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  const popup = dialog.element()
  const bounds = popup.getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(360)
  expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth + 1)
  const closeBounds = close.element().getBoundingClientRect()
  expect(closeBounds.left).toBeGreaterThanOrEqual(0)
  expect(closeBounds.right).toBeLessThanOrEqual(360)
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exit = new Promise<boolean>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      resolve(popup.isConnected && popup.textContent!.includes(site.description!))
    }
    popup.addEventListener('transitionrun', onTransition)
  })
  await close.click()
  expect(await exit).toBe(true)
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  await more.click()
  await screen.getByRole('menuitem', { name: 'common.userProfile.about' }).click()
  await expect.element(dialog).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
})

it('discards a closed rename draft and keeps a pending save in the real sidebar dialog', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  let finishRename!: () => void
  const rename = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishRename = resolve
      }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  clients.push(client)
  seedSystemFeatures(client)
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <ThemeProvider>
        <div className="flex h-150 w-80">
          <ConversationOwner rename={rename} />
        </div>
      </ThemeProvider>
    </QueryClientTestProvider>,
  )
  await screen.getByRole('button', { name: 'Saved conversation' }).click()
  await userEvent.tab()
  const more = screen.getByRole('button', { name: 'common.operation.more' }).first()
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'explore.sidebar.action.rename' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: 'common.chat.renameConversation' })
  const input = dialog.getByRole('textbox', { name: 'common.chat.conversationName' })
  await input.fill('Unsaved draft')
  const popup = dialog.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exit = new Promise<string>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      resolve((input.element() as HTMLInputElement).value)
    }
    popup.addEventListener('transitionrun', onTransition)
  })
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  expect(await exit).toBe('Unsaved draft')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'explore.sidebar.action.rename' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(input).toHaveValue('Saved conversation')
  await input.fill('Renamed conversation')
  const save = dialog.getByRole('button', { name: 'common.operation.save' })
  await save.click()
  await expect.element(save).toHaveFocus()
  await expect.element(input).toHaveAttribute('readonly')
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeDisabled()
  await userEvent.keyboard('{Enter}{Escape}')
  await expect.element(dialog).toBeVisible()
  expect(rename).toHaveBeenCalledExactlyOnceWith('saved', 'Renamed conversation')
  finishRename()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await expect.element(screen.getByRole('button', { name: 'Renamed conversation' })).toBeVisible()
})
