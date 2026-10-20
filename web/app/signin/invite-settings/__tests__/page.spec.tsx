import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '#i18n'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import InviteSettingsPage from '../page'

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  check: vi.fn(),
  replace: vi.fn(),
  profile: vi.fn(),
}))
let searchParams = new URLSearchParams()
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock({ 'login.joinWorkspace': 'Rejoindre {{workspaceName}}' }),
  }
})
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(() => 'zh-Hans'),
}))
vi.mock('@/i18n/client', () => ({ setLocaleOnClient: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => searchParams,
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: mocks.profile,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'activate.check.get': mocks.check }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'activate.post': mocks.activate,
    }),
  }
})
vi.mock('@/utils/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/timezone')>()),
  getBrowserTimezone: () => 'Asia/Shanghai',
}))

const invitation = (overrides: { account_status?: string; requires_setup?: boolean } = {}) => ({
  is_valid: true,
  data: {
    workspace_name: 'Acme',
    workspace_id: 'workspace-id',
    email: 'invitee@example.com',
    requires_setup: true,
    ...overrides,
  },
})
function setup({ data = invitation(), email = 'invitee@example.com' } = {}) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.activate.check.get.queryKey({ input: { query: { token: 'invite-token' } } }),
    data,
  )
  return renderWithConsoleQuery(<InviteSettingsPage />, {
    queryClient,
    accountProfile: { id: 'account-id', email },
    systemFeatures: { branding: { enabled: true, application_title: 'Acme AI' } },
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(useLocale).mockReturnValue('zh-Hans')
  document.title = ''
  searchParams = new URLSearchParams('invite_token=invite-token')
  mocks.check.mockResolvedValue(invitation())
  mocks.activate.mockResolvedValue({ result: 'success' })
  mocks.profile.mockImplementation(async () =>
    Response.json({
      id: 'account-id',
      name: 'Invitee',
      email: 'invitee@example.com',
      avatar: '',
      avatar_url: null,
      is_password_set: false,
      timezone: 'Asia/Shanghai',
    }),
  )
})

describe('Invitation activation', () => {
  it('names the setup page and associates a missing name error with the field', async () => {
    const user = userEvent.setup()
    setup()
    expect(
      screen.getByRole('heading', { level: 1, name: 'login.setYourAccount' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('login.setYourAccount - Acme AI')
    await user.click(screen.getByRole('button', { name: 'Rejoindre Acme' }))
    const error = await screen.findByText('login.enterYourName')
    const input = screen.getByLabelText('login.name')
    expect(input).toHaveAccessibleDescription(error.textContent ?? '')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveFocus()
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it.each([
    { locale: 'zh-Hans', expected: 'zh-Hans' },
    { locale: 'unsupported-locale', expected: 'en-US' },
  ])(
    'submits setup fields with $locale and refreshes the signed-in account',
    async ({ locale, expected }) => {
      vi.mocked(useLocale).mockReturnValue(locale as ReturnType<typeof useLocale>)
      const user = userEvent.setup()
      setup({ data: invitation({ account_status: 'active', requires_setup: true }) })
      await user.type(screen.getByLabelText('login.name'), 'Invitee{Enter}')
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'))
      expect(mocks.activate).toHaveBeenCalledExactlyOnceWith({
        body: {
          token: 'invite-token',
          name: 'Invitee',
          interface_language: expected,
          timezone: 'Asia/Shanghai',
        },
      })
      expect(mocks.profile).toHaveBeenCalled()
    },
  )

  it.each([{ requires_setup: false }, { requires_setup: undefined }])(
    'accepts an active account invitation with only its token ($requires_setup)',
    async ({ requires_setup }) => {
      const user = userEvent.setup()
      setup({ data: invitation({ account_status: 'active', requires_setup }) })
      expect(document.title).toBe('Rejoindre Acme - Acme AI')
      expect(screen.queryByLabelText('login.name')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Rejoindre Acme' }))
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'))
      expect(mocks.activate).toHaveBeenCalledExactlyOnceWith({ body: { token: 'invite-token' } })
    },
  )

  it('prevents a second submission while activation is pending and rechecks after failure', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<{ result: string }>()
    mocks.activate.mockReturnValueOnce(pending.promise)
    setup()
    await user.type(screen.getByLabelText('login.name'), 'Invitee')
    const submit = screen.getByRole('button', { name: 'Rejoindre Acme' })
    await user.dblClick(submit)
    expect(mocks.activate).toHaveBeenCalledTimes(1)
    pending.reject(new Error('Activation failed'))
    await waitFor(() =>
      expect(mocks.check).toHaveBeenCalledWith({ query: { token: 'invite-token' } }),
    )
    expect(mocks.replace).not.toHaveBeenCalled()
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'))
    expect(mocks.activate).toHaveBeenCalledTimes(2)
  })

  it('falls back to console home for an external redirect', async () => {
    const user = userEvent.setup()
    searchParams.set('redirect_url', 'https://google.com')
    setup()
    await user.type(screen.getByLabelText('login.name'), 'Invitee{Enter}')
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'))
  })

  it('returns a different signed-in account to the invitation sign-in form', async () => {
    setup({ email: 'current@example.com' })
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/signin?invite_token=invite-token'),
    )
    expect(screen.queryByRole('button', { name: 'Rejoindre Acme' })).not.toBeInTheDocument()
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('accepts a case-insensitive email match', async () => {
    const user = userEvent.setup()
    setup({ email: 'Invitee@Example.com' })
    await user.type(screen.getByLabelText('login.name'), 'Invitee{Enter}')
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce())
  })
})
