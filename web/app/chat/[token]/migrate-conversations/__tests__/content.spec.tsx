import type { AppData } from '@/models/share'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME, PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { fetchAppInfo } from '@/service/share'
import { shareQueryKeys } from '@/service/use-share'
import { webAppClient } from '@/service/webapp'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import MigrateConversationsContent from '../content'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'current-app' }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchAppInfo: vi.fn(),
}))

vi.mock('@/service/webapp', () => ({
  webAppQuery: {
    account: {
      profile: {
        get: {
          queryKey: () => ['webapp', 'account', 'profile'],
          queryOptions: (options: object) => ({
            ...options,
            queryFn: () => webAppClient.account.profile.get(),
          }),
        },
      },
    },
  },
  webAppClient: {
    account: { profile: { get: vi.fn() } },
    migration: {
      claimablePassports: { post: vi.fn() },
      claim: { post: vi.fn() },
    },
  },
}))

const appInfo = {
  app_id: 'current-app',
  custom_config: null,
  site: {
    title: 'Research Assistant',
    description: 'Search and organize research for this workspace.',
    icon_type: 'emoji',
    icon: '🔬',
    icon_background: '#E0F2FE',
  },
} satisfies AppData

beforeEach(() => {
  vi.mocked(fetchAppInfo).mockReset()
  vi.mocked(webAppClient.account.profile.get).mockResolvedValue({
    name: 'Reader',
    avatar: null,
    avatar_url: null,
  })
  vi.mocked(webAppClient.migration.claimablePassports.post).mockResolvedValue({
    data: [
      {
        index: 0,
        app_code: 'current-app',
        app_name: 'Research Assistant',
        conversation_count: 3,
        connection_count: 0,
      },
    ],
  })
  localStorage.setItem(PASSPORT_LOCAL_STORAGE_NAME('current-app'), 'anonymous-current')
  window.history.replaceState({}, '', '/chat/current-app/migrate-conversations')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

it('loads the current WebApp metadata instead of another app or the preview data', async () => {
  const request = createDeferred<AppData>()
  vi.mocked(fetchAppInfo).mockReturnValueOnce(request.promise)
  const queryClient = createTestQueryClient()
  const previousApp = { ...appInfo, site: { ...appInfo.site, title: 'Previous App' } }
  queryClient.setQueryData(shareQueryKeys.appInfo(null), previousApp)
  queryClient.setQueryData(
    shareQueryKeys.appInfo({ kind: 'default', code: 'previous-app' }),
    previousApp,
  )

  render(
    <QueryClientProvider client={queryClient}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Previous App' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'login.history.continue' })).not.toBeInTheDocument()

  request.resolve(appInfo)

  expect(await screen.findByRole('heading', { name: appInfo.site.title })).toBeInTheDocument()
  expect(screen.getByText(appInfo.site.description)).toBeInTheDocument()
  expect(screen.getByText('🔬')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'login.history.continue' })).toBeDisabled()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Writing Assistant' })).not.toBeInTheDocument()
})

it('shows a load failure instead of confirmation actions when the WebApp cannot be loaded', async () => {
  vi.mocked(fetchAppInfo).mockRejectedValueOnce(new Error('Service unavailable'))

  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  expect(await screen.findByText('share.common.appUnknownError')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'login.history.continue' })).not.toBeInTheDocument()
})

it('keeps anonymous passports when deferring to the original chat', async () => {
  const user = userEvent.setup()
  const passports = [
    [PASSPORT_LOCAL_STORAGE_NAME('current-app'), 'anonymous-current'],
    [PASSPORT_LOCAL_STORAGE_NAME('other-app'), 'anonymous-other'],
    [PASSPORT_LOCAL_STORAGE_NAME('environment:preview-app'), 'anonymous-preview'],
    [AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME('current-app'), 'signed-in-current'],
  ] as const
  for (const [key, value] of passports) localStorage.setItem(key, value)
  window.history.replaceState(
    {},
    '',
    '/chat/current-app/migrate-conversations?conversationId=existing-chat',
  )
  vi.mocked(fetchAppInfo).mockResolvedValueOnce(appInfo)

  try {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MigrateConversationsContent />
      </QueryClientProvider>,
    )

    await screen.findByRole('heading', { name: appInfo.site.title })
    await user.click(screen.getByRole('radio', { name: 'login.history.add' }))
    expect(screen.getByRole('button', { name: 'login.history.addAndContinue' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'login.history.delete' })).toBeDisabled()

    const notNow = screen.getByRole('link', { name: 'login.history.notNow' })
    expect(notNow).toHaveAttribute('href', '/chat/current-app?conversationId=existing-chat')
    await user.click(notNow)
    for (const [key, value] of passports) expect(localStorage.getItem(key)).toBe(value)
  } finally {
    for (const [key] of passports) localStorage.removeItem(key)
  }
})

it('claims all eligible anonymous data, retains the account Passport, and returns to the original App', async () => {
  const user = userEvent.setup()
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  window.history.replaceState(
    {},
    '',
    '/chat/current-app/migrate-conversations?redirect_url=%2Fchat%2Fcurrent-app%3FconversationId%3Dexisting-chat',
  )
  vi.mocked(fetchAppInfo).mockResolvedValueOnce(appInfo)
  vi.mocked(webAppClient.migration.claim.post).mockResolvedValueOnce({
    data: [
      {
        status: 'success',
        index: 0,
        app_code: 'current-app',
        access_token: 'account-passport',
        claimed_connections: 0,
        claimed_conversations: 3,
        stop_requested_run_count: 0,
      },
    ],
  })

  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  await user.click(await screen.findByRole('radio', { name: 'login.history.add' }))
  await user.click(screen.getByRole('button', { name: 'login.history.addAndContinue' }))

  expect(webAppClient.migration.claim.post).toHaveBeenCalledWith(
    { body: { passports: ['anonymous-current'] } },
    { context: { silent: true } },
  )
  expect(localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME('current-app'))).toBeNull()
  expect(localStorage.getItem(AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME('current-app'))).toBeNull()
  expect(replace).toHaveBeenCalledWith('/chat/current-app?conversationId=existing-chat')
})
