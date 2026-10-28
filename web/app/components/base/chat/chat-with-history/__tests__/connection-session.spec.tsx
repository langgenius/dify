import type { EndUserConnectionPreflightPayload } from '@dify/contracts/api/web/types.gen'
// oxlint-disable-next-line no-restricted-imports -- Type the existing Chat SSE callbacks at this test's transport boundary.
import type { IOtherOptions } from '@/service/base'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WebAppEntryContext } from '@/app/components/share/webapp-entry'
import { useWebAppStore } from '@/context/web-app-context'
import { setWebAppAccessToken, setWebAppPassport } from '@/service/webapp-auth'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import ChatWithHistory from '../index'
import { chatConnectionEntry, checkedRevision, selectedConnectionId } from './connection-fixture'

const { post } = vi.hoisted(() => ({
  post: vi.fn<(url: string, options: unknown, stream: IOtherOptions) => Promise<void>>(),
}))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/chat/session-app',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ token: 'session-app' }),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: post,
}))
vi.mock('@/i18n/client', () => ({ changeLanguage: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchConversations: vi.fn().mockResolvedValue({ data: [], has_more: false, limit: 100 }),
  generationConversationName: vi.fn().mockResolvedValue({
    id: 'created-conversation',
    name: 'Research conversation',
    inputs: {},
    introduction: '',
  }),
  stopChatMessageResponding: vi.fn().mockResolvedValue({}),
}))

it('reconfirms restored connections on a new chat after the first server conversation ID without losing the first answer', async () => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/chat/session-app')
  setWebAppAccessToken('session-account', 'end_user')
  setWebAppPassport({ kind: 'default', code: 'session-app' }, 'app-passport')
  useWebAppStore.setState({
    appInfo: {
      app_id: 'session-app-id',
      end_user_id: 'session-user',
      mode: 'advanced-chat',
      custom_config: null,
      site: { title: 'Repository assistant' },
    },
    appMeta: { tool_icons: {} },
    appParams: createChatConfigFixture(),
  })
  const checks: EndUserConnectionPreflightPayload[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    const connection = {
      id: selectedConnectionId,
      name: 'Research GitHub',
      account_label: 'research@example.com',
      provider: 'langgenius/github/github',
      credential_type: 'oauth2',
      credential_status: 'connected',
      expires_at: null,
      created_at: 1700000000,
      updated_at: 1700000000,
      last_active_at: 1700000000,
    }
    if (path.endsWith('/connections/configuration'))
      return Response.json({ connections: { 'github-node': connection } })
    if (path.endsWith('/connections/preflight')) {
      checks.push((await request.json()) as EndUserConnectionPreflightPayload)
      return Response.json({
        connection_revision: checkedRevision,
        ready: true,
        connections: [
          {
            node_id: 'github-node',
            connection_id: selectedConnectionId,
            status: 'connected',
            check: null,
          },
        ],
      })
    }
    if (path.endsWith('/connections'))
      return Response.json({ data: [connection], has_more: false, next_cursor: null })
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  })
  const user = userEvent.setup()
  renderWithConsoleQuery(
    <WebAppEntryContext value={chatConnectionEntry}>
      <ChatWithHistory />
    </WebAppEntryContext>,
  )
  const start = await screen.findByRole('button', { name: 'share.connections.setup.startUsingApp' })
  await waitFor(() => expect(start).toBeEnabled())
  expect(post).not.toHaveBeenCalled()
  await user.click(start)
  await user.type(
    screen.getByPlaceholderText(/common.chat.inputPlaceholder/),
    'Find examples{Enter}',
  )
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await act(async () => {
    post.mock.calls[0]![2].onData?.('Repository examples', true, {
      messageId: 'answer',
      conversationId: 'created-conversation',
    })
    await post.mock.calls[0]![2].onCompleted?.()
  })
  expect(await screen.findByText('Repository examples')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'share.connections.setup.startUsingApp' }),
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(checks.some((check) => check.conversation_id === 'created-conversation')).toBe(true),
  )
  await user.click(screen.getByRole('button', { name: 'share.chat.newChat' }))
  const newStart = await screen.findByRole('button', {
    name: 'share.connections.setup.startUsingApp',
  })
  await waitFor(() => expect(newStart).toBeEnabled())
  expect(screen.queryByText('Repository examples')).not.toBeInTheDocument()
  expect(post).toHaveBeenCalledTimes(1)
  expect(checks.at(-1)).not.toHaveProperty('conversation_id')
})
