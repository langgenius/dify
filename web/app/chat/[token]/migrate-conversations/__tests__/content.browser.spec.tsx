import type { AppData } from '@/models/share'
import { QueryClientProvider } from '@tanstack/react-query'
import { onTestFinished } from 'vite-plus/test'
import { render } from 'vitest-browser-react'
import { PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { fetchAppInfo } from '@/service/share'
import { createTestQueryClient } from '@/test/query-client'
import MigrateConversationsContent from '../content'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'chatbot-app' }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchAppInfo: vi.fn(),
}))

vi.mock('@/service/webapp/browser', () => ({
  webAppBrowserLink: { call: (...args: unknown[]) => mocks.call(...args) },
}))

const appInfo = {
  app_id: 'chatbot-app',
  mode: 'chat',
  custom_config: null,
  site: {
    title: 'Writing Assistant',
    description: 'Write and revise text.',
    icon_type: 'emoji',
    icon: '✍️',
    icon_background: '#E0F2FE',
  },
} satisfies AppData

const passportKey = PASSPORT_LOCAL_STORAGE_NAME('chatbot-app')
const target = '/chat/chatbot-app?conversationId=previous-chat'
let conversationCount: number
let destinations: string[]

beforeEach(() => {
  conversationCount = 3
  destinations = []
  window.localStorage.clear()
  window.localStorage.setItem(passportKey, 'anonymous-chatbot')
  window.history.replaceState(
    {},
    '',
    `/chat/chatbot-app/migrate-conversations?${new URLSearchParams({ redirect_url: target })}`,
  )
  vi.mocked(fetchAppInfo).mockResolvedValue(appInfo)
  mocks.call.mockImplementation(async (path: string[]) => {
    switch (path.join('.')) {
      case 'account.profile.get':
        return { name: 'Reader', avatar: null, avatar_url: null }
      case 'migration.claimablePassports.post':
        return {
          data: [
            {
              index: 0,
              app_code: 'chatbot-app',
              app_name: appInfo.site.title,
              conversation_count: conversationCount,
              connection_count: 0,
            },
          ],
        }
      case 'migration.claim.post':
        return {
          data: [
            {
              status: 'success',
              index: 0,
              app_code: 'chatbot-app',
              access_token: 'account-passport',
              claimed_connections: 0,
              claimed_conversations: conversationCount,
              stop_requested_run_count: 0,
            },
          ],
        }
      default:
        throw new Error(`Unexpected Webapp operation: ${path.join('.')}`)
    }
  })
})

afterEach(() => {
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
})

function preventDocumentNavigation() {
  const onNavigate = (event: NavigateEvent) => {
    destinations.push(event.destination.url)
    event.preventDefault()
  }
  window.navigation.addEventListener('navigate', onNavigate)
  onTestFinished(() => window.navigation.removeEventListener('navigate', onNavigate))
}

async function showMigration() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )
}

it('offers Chatbot history migration by default and transfers the selected anonymous Passport', async () => {
  preventDocumentNavigation()
  const screen = await showMigration()

  await expect.element(screen.getByRole('radio', { name: 'login.history.add' })).toBeChecked()
  await expect.element(screen.getByRole('note')).toHaveTextContent('login.history.transferWarning')
  await screen.getByRole('button', { name: 'login.history.addAndContinue' }).click()

  await expect.poll(() => destinations).toEqual([new URL(target, window.location.origin).href])
  expect(mocks.call).toHaveBeenCalledWith(
    ['migration', 'claim', 'post'],
    { body: { passports: ['anonymous-chatbot'] } },
    expect.objectContaining({ context: { silent: true } }),
  )
  expect(window.localStorage.getItem(passportKey)).toBeNull()
})

it('returns directly to the Chatbot when no anonymous connections or conversations remain', async () => {
  conversationCount = 0
  preventDocumentNavigation()
  const screen = await showMigration()

  await expect.poll(() => destinations).toEqual([new URL(target, window.location.origin).href])
  await expect.element(screen.getByRole('radio')).not.toBeInTheDocument()
  expect(mocks.call.mock.calls.map(([path]) => path.join('.'))).not.toContain(
    'migration.claim.post',
  )
  expect(window.localStorage.getItem(passportKey)).toBe('anonymous-chatbot')
})
