import type { AppData } from '@/models/share'
import { QueryClientProvider } from '@tanstack/react-query'
import { onTestFinished } from 'vite-plus/test'
import { render } from 'vitest-browser-react'
import { PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { route, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import MigrateConversationsContent from '../content'

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
let mode: AppData['mode']

const fake = setupFakeApi({
  routes: [
    route('GET', 'public', '/site', () => ({ ...appInfo, mode })),
    route('GET', 'public', '/account/profile', () => ({
      name: 'Reader',
      avatar: null,
      avatar_url: null,
    })),
    route('POST', 'public', '/migration/claimable-passports', () => ({
      data: [
        {
          index: 0,
          app_code: 'chatbot-app',
          app_name: appInfo.site.title,
          conversation_count: conversationCount,
          connection_count: 0,
        },
      ],
    })),
    route('POST', 'public', '/migration/claim', () => ({
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
    })),
  ],
})
const claim = () => fake.route('POST', 'public', '/migration/claim')
const candidates = () => fake.route('POST', 'public', '/migration/claimable-passports')

beforeEach(() => {
  conversationCount = 3
  destinations = []
  mode = 'chat'
  window.localStorage.clear()
  window.localStorage.setItem(passportKey, 'anonymous-chatbot')
  window.history.replaceState(
    {},
    '',
    `/chat/chatbot-app/migrate-conversations?${new URLSearchParams({ redirect_url: target })}`,
  )
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
  const { NavigationProvider } = createTestNavigation({
    params: { token: 'chatbot-app' },
    url: window.location.pathname + window.location.search,
  })
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <NavigationProvider>
        <MigrateConversationsContent />
      </NavigationProvider>
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
  expect(claim()).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ body: { passports: ['anonymous-chatbot'] } }),
  )
  expect(window.localStorage.getItem(passportKey)).toBeNull()
})

it('returns directly to the Chatbot when no anonymous connections or conversations remain', async () => {
  conversationCount = 0
  preventDocumentNavigation()
  const screen = await showMigration()

  await expect.poll(() => destinations).toEqual([new URL(target, window.location.origin).href])
  await expect.element(screen.getByRole('radio')).not.toBeInTheDocument()
  expect(claim()).not.toHaveBeenCalled()
  expect(window.localStorage.getItem(passportKey)).toBe('anonymous-chatbot')
})

it('keeps the legacy Agent outside migration and preserves anonymous data when continuing', async () => {
  mode = 'agent-chat'
  preventDocumentNavigation()
  const screen = await showMigration()

  await expect.element(screen.getByText('login.history.unsupportedTitle')).toBeVisible()
  await expect
    .element(screen.getByRole('radio', { name: 'login.history.add' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('radio', { name: 'login.history.continueWithoutAdding' }))
    .toBeChecked()
  await screen.getByRole('button', { name: 'login.history.continue' }).click()

  await expect.poll(() => destinations).toEqual([new URL(target, window.location.origin).href])
  expect(candidates()).not.toHaveBeenCalled()
  expect(claim()).not.toHaveBeenCalled()
  expect(window.localStorage.getItem(passportKey)).toBe('anonymous-chatbot')
})
