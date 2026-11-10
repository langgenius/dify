import type { WebAppParametersResponse } from '@dify/contracts/api/web/types.gen'
import type { AppData } from '@/models/share'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vite-plus/test'
import { AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME, PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { fetchAppInfo } from '@/service/share'
import { shareQueryKeys } from '@/service/use-share'
import { webAppClient } from '@/service/webapp'
import { webAppLogout } from '@/service/webapp-auth'
import { beginWebAppAccountLogin } from '@/service/webapp/login'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import { createWebAccountProfile } from '@/test/webapp-account-profile'
import MigrateConversationsContent from '../content'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'current-app' }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchAppInfo: vi.fn(),
}))

vi.mock('@/service/webapp-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/webapp-auth')>()),
  webAppLogout: vi.fn(),
}))

vi.mock('@/service/webapp/login', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/webapp/login')>()),
  beginWebAppAccountLogin: vi.fn(),
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
    parameters: { get: vi.fn() },
    migration: {
      claimablePassports: { post: vi.fn() },
      claim: { post: vi.fn() },
    },
  },
}))

const appInfo = {
  app_id: 'current-app',
  mode: 'advanced-chat',
  custom_config: null,
  site: {
    title: 'Research Assistant',
    description: 'Search and organize research for this workspace.',
    icon_type: 'emoji',
    icon: '🔬',
    icon_background: '#E0F2FE',
  },
} satisfies AppData

const parameters: WebAppParametersResponse = {
  account_login_enabled: true,
  account_login_url: 'https://accounts.example/signin',
  allow_anonymous_end_user_auth: true,
  annotation_reply: {},
  connection_requirements: [],
  connection_revision: null,
  file_upload: {},
  more_like_this: {},
  requires_end_user_connections: false,
  retriever_resource: {},
  sensitive_word_avoidance: {},
  speech_to_text: {},
  suggested_questions: [],
  suggested_questions_after_answer: {},
  system_parameters: {
    audio_file_size_limit: 50,
    file_size_limit: 15,
    image_file_size_limit: 10,
    video_file_size_limit: 100,
    workflow_file_upload_limit: 10,
  },
  text_to_speech: {},
  user_input_form: [],
}

beforeEach(() => {
  vi.mocked(fetchAppInfo).mockReset()
  vi.mocked(webAppClient.parameters.get).mockReset().mockResolvedValue(parameters)
  vi.mocked(webAppLogout).mockReset().mockResolvedValue(undefined)
  vi.mocked(beginWebAppAccountLogin)
    .mockReset()
    .mockResolvedValue('https://accounts.example/signin?code_challenge=challenge')
  vi.mocked(webAppClient.account.profile.get).mockResolvedValue(
    createWebAccountProfile({ name: 'Reader' }),
  )
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
  expect(screen.getByRole('button', { name: 'login.history.addAndContinue' })).toBeEnabled()
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

it('skips migration when the response contains no connections or conversations', async ({
  onTestFinished,
}) => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  onTestFinished(() => replace.mockRestore())
  vi.mocked(fetchAppInfo).mockResolvedValueOnce(appInfo)
  vi.mocked(webAppClient.migration.claimablePassports.post).mockResolvedValueOnce({
    data: [
      {
        index: 0,
        app_code: 'current-app',
        app_name: 'Research Assistant',
        connection_count: 0,
        conversation_count: 0,
      },
    ],
  })
  window.history.replaceState(
    {},
    '',
    '/chat/current-app/migrate-conversations?redirect_url=%2Fworkflow%2Fcurrent-app',
  )

  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  await vi.waitFor(() =>
    expect(replace).toHaveBeenCalledWith(`${window.location.origin}/workflow/current-app`),
  )
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(webAppClient.migration.claim.post).not.toHaveBeenCalled()
  expect(localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME('current-app'))).toBe('anonymous-current')
})

it.each([
  'javascript:alert(1)',
  'https://untrusted.example/chat/current-app',
  '//untrusted.example/chat/current-app',
  '/my-apps',
])(
  'rejects unsafe migration return target %s before automatically leaving the page',
  async (redirect) => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    onTestFinished(() => replace.mockRestore())
    vi.mocked(fetchAppInfo).mockResolvedValueOnce(appInfo)
    vi.mocked(webAppClient.migration.claimablePassports.post).mockResolvedValueOnce({ data: [] })
    const query = new URLSearchParams({ redirect_url: redirect, conversationId: 'existing-chat' })
    window.history.replaceState({}, '', `/chat/current-app/migrate-conversations?${query}`)

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MigrateConversationsContent />
      </QueryClientProvider>,
    )

    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        '/chat/current-app?conversationId=existing-chat',
      ),
    )
  },
)

it('sanitizes the deferred link and explicit continue action for unsafe return targets', async ({
  onTestFinished,
}) => {
  const user = userEvent.setup()
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  onTestFinished(() => replace.mockRestore())
  vi.mocked(fetchAppInfo).mockResolvedValueOnce(appInfo)
  const query = new URLSearchParams({ redirect_url: 'javascript:alert(1)' })
  window.history.replaceState({}, '', `/chat/current-app/migrate-conversations?${query}`)

  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  expect(await screen.findByRole('link', { name: 'login.history.notNow' })).toHaveAttribute(
    'href',
    '/chat/current-app',
  )
  await user.click(screen.getByRole('radio', { name: 'login.history.delete' }))
  await user.click(screen.getByRole('button', { name: 'login.history.deleteAndContinue' }))
  await vi.waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith('/chat/current-app'))
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
    expect(screen.getByRole('radio', { name: 'login.history.delete' })).toBeEnabled()

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
  expect(replace).toHaveBeenCalledWith(
    `${window.location.origin}/chat/current-app?conversationId=existing-chat`,
  )
})

it('deletes only matching anonymous passports locally and continues without claiming data', async ({
  onTestFinished,
}) => {
  const user = userEvent.setup()
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  onTestFinished(() => replace.mockRestore())
  const unrelatedKey = PASSPORT_LOCAL_STORAGE_NAME('unrelated-app')
  const accountKey = AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME('current-app')
  localStorage.setItem(unrelatedKey, 'unrelated-anonymous')
  localStorage.setItem(accountKey, 'authenticated-current')
  onTestFinished(() => {
    localStorage.removeItem(unrelatedKey)
    localStorage.removeItem(accountKey)
  })
  vi.mocked(fetchAppInfo).mockResolvedValueOnce(appInfo)
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  await user.click(await screen.findByRole('radio', { name: 'login.history.delete' }))
  await user.click(screen.getByRole('button', { name: 'login.history.deleteAndContinue' }))

  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/chat/current-app'))
  expect(localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME('current-app'))).toBeNull()
  expect(localStorage.getItem(unrelatedKey)).toBe('unrelated-anonymous')
  expect(localStorage.getItem(accountKey)).toBe('authenticated-current')
  expect(webAppClient.migration.claim.post).not.toHaveBeenCalled()
})

it('does not load migration candidates for unsupported Apps and keeps the current passport when continuing', async ({
  onTestFinished,
}) => {
  const user = userEvent.setup()
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  onTestFinished(() => replace.mockRestore())
  vi.mocked(fetchAppInfo).mockResolvedValueOnce({ ...appInfo, mode: 'completion' })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  expect(await screen.findByText('login.history.unsupportedTitle')).toBeInTheDocument()
  expect(screen.getByText('login.history.unsupportedDescription')).toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: 'login.history.add' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'login.history.notNow' })).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'login.history.continueWithoutAdding' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'login.history.delete' })).not.toBeChecked()
  expect(webAppClient.migration.claimablePassports.post).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'login.history.continue' }))

  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/chat/current-app'))
  expect(localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME('current-app'))).toBe('anonymous-current')
  expect(webAppClient.migration.claim.post).not.toHaveBeenCalled()
})

it('deletes only the current unsupported App passport without loading or claiming candidates', async ({
  onTestFinished,
}) => {
  const user = userEvent.setup()
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  onTestFinished(() => replace.mockRestore())
  const unrelatedKey = PASSPORT_LOCAL_STORAGE_NAME('unrelated-app')
  const accountKey = AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME('current-app')
  localStorage.setItem(unrelatedKey, 'unrelated-anonymous')
  localStorage.setItem(accountKey, 'authenticated-current')
  onTestFinished(() => {
    localStorage.removeItem(unrelatedKey)
    localStorage.removeItem(accountKey)
  })
  vi.mocked(fetchAppInfo).mockResolvedValueOnce({ ...appInfo, mode: 'completion' })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  await user.click(await screen.findByRole('radio', { name: 'login.history.delete' }))
  await user.click(screen.getByRole('button', { name: 'login.history.deleteAndContinue' }))

  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/chat/current-app'))
  expect(localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME('current-app'))).toBeNull()
  expect(localStorage.getItem(unrelatedKey)).toBe('unrelated-anonymous')
  expect(localStorage.getItem(accountKey)).toBe('authenticated-current')
  expect(webAppClient.migration.claimablePassports.post).not.toHaveBeenCalled()
  expect(webAppClient.migration.claim.post).not.toHaveBeenCalled()
})

it('requests Console account switching only after WebApp logout succeeds, preserving anonymous data and the return URL', async ({
  onTestFinished,
}) => {
  const user = userEvent.setup()
  const logout = createDeferred()
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  onTestFinished(() => assign.mockRestore())
  vi.mocked(fetchAppInfo).mockResolvedValueOnce(appInfo)
  vi.mocked(webAppLogout).mockReturnValueOnce(logout.promise)
  window.history.replaceState(
    {},
    '',
    '/chat/current-app/migrate-conversations?redirect_url=%2Fchat%2Fcurrent-app%3FconversationId%3Dexisting-chat',
  )
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  await user.click(await screen.findByRole('button', { name: 'login.history.useDifferentAccount' }))
  expect(await screen.findByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
  expect(webAppClient.parameters.get).toHaveBeenCalledWith(undefined, {
    context: { address: { kind: 'default', code: 'current-app' }, silent: true },
  })
  expect(webAppLogout).toHaveBeenCalledWith({ kind: 'default', code: 'current-app' })
  expect(beginWebAppAccountLogin).not.toHaveBeenCalled()
  expect(assign).not.toHaveBeenCalled()
  expect(webAppClient.migration.claim.post).not.toHaveBeenCalled()

  logout.resolve()
  await vi.waitFor(() => {
    expect(beginWebAppAccountLogin).toHaveBeenCalledExactlyOnceWith(
      'https://accounts.example/signin',
      `${window.location.origin}/chat/current-app?conversationId=existing-chat`,
    )
    expect(assign).toHaveBeenCalledWith(
      'https://accounts.example/signin?code_challenge=challenge&switch_account=1',
    )
  })
  expect(localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME('current-app'))).toBe('anonymous-current')
})

it.each(['parameters', 'logout'] as const)(
  'retains the migration screen and stops account switching when %s fails',
  async (failure) => {
    const user = userEvent.setup()
    vi.mocked(fetchAppInfo).mockResolvedValueOnce(appInfo)
    const error = new Error('Unable to switch account')
    if (failure === 'parameters')
      vi.mocked(webAppClient.parameters.get).mockRejectedValueOnce(error)
    else vi.mocked(webAppLogout).mockRejectedValueOnce(error)
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MigrateConversationsContent />
      </QueryClientProvider>,
    )

    await user.click(
      await screen.findByRole('button', { name: 'login.history.useDifferentAccount' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to switch account')
    expect(screen.getByRole('button', { name: 'login.history.useDifferentAccount' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'login.history.notNow' })).toBeInTheDocument()
    expect(beginWebAppAccountLogin).not.toHaveBeenCalled()
    expect(webAppClient.migration.claim.post).not.toHaveBeenCalled()
    if (failure === 'parameters') expect(webAppLogout).not.toHaveBeenCalled()
  },
)
