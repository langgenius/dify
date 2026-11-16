import { QueryClientProvider } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  CONVERSATION_ID_INFO,
  TAB_CONVERSATION_ID_INFO,
} from '@/app/components/base/chat/constants'
import { useWebAppStore } from '@/context/web-app-context'
import { AppSourceType } from '@/service/share'
import { shareQueryKeys } from '@/service/use-share'
import { createConsoleQueryClient, seedSystemFeatures } from '@/test/console/query-data'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ChatWithHistory from '../index'

// boundary: Browser Mode has no Next App Router; the real chat owner consumes its route contract.
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/agent/test',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const conversation = {
  id: 'saved',
  name: 'Saved conversation',
  inputs: {},
  introduction: '',
}

async function renderChatOwner() {
  await page.viewport(960, 600)
  const appInfo = {
    app_id: 'app-1',
    end_user_id: 'user-1',
    site: { title: 'Keyboard chat', icon: '😀', icon_type: 'emoji' as const },
    custom_config: null,
  }
  const selection = JSON.stringify({ 'app-1': { 'user-1': '' } })
  localStorage.setItem(CONVERSATION_ID_INFO, selection)
  sessionStorage.setItem(TAB_CONVERSATION_ID_INFO, selection)
  localStorage.setItem('webappSidebarCollapse', 'expanded')
  useWebAppStore.setState({
    appInfo,
    appParams: createChatConfigFixture(),
    appMeta: { tool_icons: {} },
  })
  const client = createConsoleQueryClient()
  const listKey = (pinned: boolean) =>
    shareQueryKeys.conversationList(null, {
      appSourceType: AppSourceType.webApp,
      appId: 'app-1',
      pinned,
      limit: 100,
    })
  client.setQueryData(listKey(false), { data: [conversation], has_more: false, limit: 100 })
  client.setQueryData(listKey(true), { data: [], has_more: false, limit: 100 })
  seedSystemFeatures(client, { branding: { enabled: false } })
  onTestFinished(() => {
    useWebAppStore.setState({ appInfo: undefined, appParams: undefined, appMeta: undefined })
  })
  onTestFinished(guardUnexpectedFetch())
  return render(
    <QueryClientProvider client={client}>
      <section aria-label="Chat preview" className="h-150 w-240">
        <button type="button">Before chat</button>
        <ChatWithHistory />
      </section>
    </QueryClientProvider>,
  )
}

it('keeps desktop keyboard focus visible across sidebar states and conversation actions', async () => {
  // Real Chromium is needed to prove native inert Tab skipping, focus restoration
  // during collapse, and focus-visible opacity on a non-hovered conversation row.
  const screen = await renderChatOwner()
  const before = screen.getByRole('button', { name: 'Before chat' })
  const collapse = screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' })
  const chat = screen.getByRole('textbox')
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

it('keeps the floating sidebar available while its menu or focus is inside and closes after focus leaves', async () => {
  // Pointer leave and Escape cross the real portal boundary; focus must return
  // to a visible, interactive trigger instead of a newly inert offscreen panel.
  const screen = await renderChatOwner()
  await screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }).click()
  await screen.getByRole('region', { name: 'Chat preview' }).hover({ position: { x: 2, y: 150 } })
  const conversation = screen.getByRole('button', { name: 'Saved conversation' }).last()
  await expect.element(conversation).toBeVisible()
  conversation.element().focus()
  await expect.element(conversation).toHaveFocus()
  await userEvent.tab()
  const more = screen
    .getByRole('button', { name: 'common.operation.more' })
    .all()
    .find((button) => button.element() === document.activeElement)!
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toBeVisible()
  await screen.getByRole('button', { name: 'Before chat' }).hover()
  await userEvent.keyboard('{Escape}')
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ checkOpacity: true })).toBe(true)

  // The pointer has already left: Tab between sidebar controls must keep the
  // panel usable, but moving focus outside must make its actions inert.
  await userEvent.tab({ shift: true })
  await expect.element(conversation).toHaveFocus()
  await userEvent.tab()
  await expect.element(more).toHaveFocus()
  const outside = screen.getByRole('button', { name: 'Before chat' })
  await outside.click()
  await expect.element(outside).toHaveFocus()
  const expand = screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' }).last()
  await userEvent.tab()
  await expect.element(expand).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('textbox')).toHaveFocus()
})
