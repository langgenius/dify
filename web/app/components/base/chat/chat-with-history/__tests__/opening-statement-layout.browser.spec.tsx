import { QueryClientProvider } from '@tanstack/react-query'
import { page } from 'vite-plus/test/browser'
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
  usePathname: () => '/chat/test',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

async function renderNewChat(
  userInputForm: ReturnType<typeof createChatConfigFixture>['user_input_form'],
) {
  await page.viewport(1280, 1200)
  const appInfo = {
    app_id: 'app-1',
    end_user_id: 'user-1',
    site: { title: 'Opener chat', icon: '😀', icon_type: 'emoji' as const },
    custom_config: null,
  }
  const selection = JSON.stringify({ 'app-1': { 'user-1': '' } })
  localStorage.setItem(CONVERSATION_ID_INFO, selection)
  sessionStorage.setItem(TAB_CONVERSATION_ID_INFO, selection)
  useWebAppStore.setState({
    appInfo,
    appParams: createChatConfigFixture({
      opening_statement: 'Hello from the opener',
      user_input_form: userInputForm,
    }),
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
  client.setQueryData(listKey(false), { data: [], has_more: false, limit: 100 })
  client.setQueryData(listKey(true), { data: [], has_more: false, limit: 100 })
  seedSystemFeatures(client, { branding: { enabled: false } })
  onTestFinished(() => {
    useWebAppStore.setState({ appInfo: undefined, appParams: undefined, appMeta: undefined })
    localStorage.clear()
    sessionStorage.clear()
  })
  onTestFinished(guardUnexpectedFetch())
  return render(
    <QueryClientProvider client={client}>
      <div className="h-300 w-320">
        <ChatWithHistory />
      </div>
    </QueryClientProvider>,
  )
}

it('shows the opening statement right below the collapsed inputs form', async () => {
  // Real layout is the contract: the opener must follow the collapsed setup card
  // instead of being centered inside a half-viewport box (langgenius/dify#46532).
  const screen = await renderNewChat([
    { 'text-input': { variable: 'topic', label: 'Topic', required: false } },
  ])
  await screen.getByRole('button', { name: 'share.chat.startChat' }).click()

  const opener = screen.getByText('Hello from the opener')
  const setupTitle = screen.getByText('share.chat.chatSettingsTitle')
  await expect.element(opener).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'common.operation.edit' })).toBeVisible()

  const gap =
    opener.element().getBoundingClientRect().top -
    setupTitle.element().getBoundingClientRect().bottom
  // Collapsed card padding, the separator and the opener's own spacing fit well under 200px.
  expect(gap).toBeLessThan(200)
})

it('keeps the opening statement centered when the app has no inputs form', async () => {
  const screen = await renderNewChat([])

  const opener = screen.getByText('Hello from the opener')
  await expect.element(opener).toBeVisible()
  // The welcome box is still at least half the viewport tall, so the opener sits well below the top.
  expect(opener.element().getBoundingClientRect().top).toBeGreaterThan(300)
})
