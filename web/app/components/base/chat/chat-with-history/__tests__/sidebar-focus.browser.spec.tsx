import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ChatWithHistory from '../index'

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'pc',
  MediaType: { mobile: 'mobile', tablet: 'tablet', pc: 'pc' },
}))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/agent/test',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/context/web-app-context', () => ({ useWebAppStore: () => null }))
vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['sidebar-focus-system-features'],
    initialData: { branding: { enabled: false } },
    queryFn: async () => ({ branding: { enabled: false } }),
    staleTime: Infinity,
  }),
}))
// Replace conversation loading and the chat renderer; keep the production layout,
// sidebar, header, and conversation menu that own focus and visibility real.
vi.mock('../hooks', () => ({
  useChatWithHistory: () => {
    const [sidebarCollapseState, setSidebarCollapseState] = useState(false)
    return {
      appData: { site: { title: 'Keyboard chat', icon: '😀', icon_type: 'emoji' } },
      pinnedConversationList: [],
      conversationList: [
        { id: 'saved', name: 'Saved conversation', inputs: null, introduction: '' },
      ],
      currentConversationId: '',
      inputsForms: [],
      appPrevChatTree: [],
      newConversationInputs: {},
      newConversationInputsRef: { current: {} },
      sidebarCollapseState,
      handleSidebarCollapse: setSidebarCollapseState,
      handleNewConversation: vi.fn(),
      handleChangeConversation: vi.fn(),
      isInstalledApp: true,
      isResponding: false,
    }
  },
}))
vi.mock('../chat-wrapper', () => ({
  default: () => <button type="button">Chat input boundary</button>,
}))

it('keeps desktop keyboard focus visible across sidebar states and conversation actions', async () => {
  // Real Chromium is needed to prove native inert Tab skipping, focus restoration
  // during collapse, and focus-visible opacity on a non-hovered conversation row.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const screen = await render(
    <QueryClientProvider client={client}>
      <div className="h-150 w-240">
        <button type="button">Before chat</button>
        <ChatWithHistory />
      </div>
    </QueryClientProvider>,
  )
  const before = screen.getByRole('button', { name: 'Before chat' })
  const collapse = screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' })
  const chat = screen.getByRole('button', { name: 'Chat input boundary' })
  await before.click()
  await userEvent.tab()
  await expect.element(collapse).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'share.chat.newChat' })).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Saved conversation' })).toHaveFocus()
  await userEvent.tab()
  const more = screen.getByRole('button', { name: 'common.operation.more' }).first()
  await expect.element(more).toHaveFocus()
  expect(getComputedStyle(more.element()).opacity).toBe('1')
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(chat).toHaveFocus()

  // Collapsing must put focus on the visible replacement toggle, and the next
  // native Tab must skip both hidden copies of the sidebar's actions.
  await collapse.click()
  const expand = screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' }).last()
  await expect.element(expand).toHaveFocus()
  await userEvent.tab()
  await expect.element(chat).toHaveFocus()
  await userEvent.tab({ shift: true })
  await expect.element(expand).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(collapse).toHaveFocus()
  expect(collapse.element().checkVisibility({ checkOpacity: true })).toBe(true)
})

it('keeps the floating sidebar available through its portalled menu and closes after focus leaves', async () => {
  // Pointer leave and Escape cross the real portal boundary; focus must return
  // to a visible, interactive trigger instead of a newly inert offscreen panel.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const screen = await render(
    <QueryClientProvider client={client}>
      <section aria-label="Chat preview" className="h-150 w-240">
        <button type="button">Outside sidebar</button>
        <ChatWithHistory />
      </section>
    </QueryClientProvider>,
  )
  await screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }).click()
  await screen.getByRole('region', { name: 'Chat preview' }).hover({ position: { x: 2, y: 150 } })
  const conversation = screen.getByRole('button', { name: 'Saved conversation' }).last()
  await expect.element(conversation).toBeVisible()
  await conversation.click()
  await userEvent.tab()
  const more = screen.getByRole('button', { name: 'common.operation.more' }).nth(2)
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toBeVisible()
  await screen.getByRole('button', { name: 'Outside sidebar' }).hover()
  await userEvent.keyboard('{Escape}')
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ checkOpacity: true })).toBe(true)
  expect(more.element().closest('[inert]')).toBeNull()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(more).toHaveFocus()
  await screen.getByRole('button', { name: 'Outside sidebar' }).click()
  await expect.poll(() => conversation.element().closest('[inert]')).not.toBeNull()
})

it('closes the floating sidebar when both the pointer and keyboard focus leave it', async () => {
  // Native pointer leave precedes blur here. Tab between sidebar controls must
  // keep the panel usable, but moving focus outside must make its actions inert.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const screen = await render(
    <QueryClientProvider client={client}>
      <section aria-label="Chat preview" className="h-150 w-240">
        <button type="button">Outside sidebar</button>
        <ChatWithHistory />
      </section>
    </QueryClientProvider>,
  )
  await screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }).click()
  await screen.getByRole('region', { name: 'Chat preview' }).hover({ position: { x: 2, y: 150 } })
  const conversation = screen.getByRole('button', { name: 'Saved conversation' }).last()
  await conversation.click()
  await screen.getByRole('button', { name: 'Outside sidebar' }).hover()
  await expect.element(conversation).toHaveFocus()

  await userEvent.tab()
  const more = screen.getByRole('button', { name: 'common.operation.more' }).nth(2)
  await expect.element(more).toHaveFocus()
  await userEvent.tab({ shift: true })
  await expect.element(conversation).toHaveFocus()

  const outside = screen.getByRole('button', { name: 'Outside sidebar' })
  await outside.click()
  await expect.element(outside).toHaveFocus()
  await expect.poll(() => conversation.element().closest('[inert]')).not.toBeNull()
})
