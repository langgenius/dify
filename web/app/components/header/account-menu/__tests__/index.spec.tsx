import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import AccountAvatar from '@/app/account/(commonLayout)/avatar'
import {
  OAUTH_REGISTRATION_GA_SENT_KEY,
  REGISTRATION_SUCCESS_STORAGE_KEY,
} from '@/app/components/base/amplitude/registration-session-state'
import AccountSection from '@/app/components/main-nav/components/account-section'
import EducationUserInfo from '@/app/education/user-info'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { renderWithConsoleQuery as renderWithConsoleQueryWithoutUrlState } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import AccountMenu from '../index'

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'logout.post': logout }),
  }
})

vi.mock('@/app/components/base/amplitude/utils', () => ({ resetUser: vi.fn() }))

function seedSession() {
  window.sessionStorage.setItem(
    REGISTRATION_SUCCESS_STORAGE_KEY,
    JSON.stringify({
      registrationId: 'registration-1',
      occurredAt: Date.now(),
      method: 'oauth',
      attribution: {},
    }),
  )
  window.sessionStorage.setItem(OAUTH_REGISTRATION_GA_SENT_KEY, 'true')
}

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

const userProfile = {
  id: 'current-user',
  name: 'Current User',
  email: 'current@example.com',
  avatar_url: 'current-avatar.png',
}
const accountMenuAccessibleName = `${userProfile.name} accountSettings.account.account`

const onUrlUpdate = vi.fn()
const renderWithConsoleQuery = createNuqsTestRenderer(
  renderWithConsoleQueryWithoutUrlState,
  () => ({ onUrlUpdate }),
)

const renderAccountMenu = () => {
  const queryClient = createAccountProfileQueryClient(userProfile)

  return renderWithConsoleQuery(
    <AccountMenu
      trigger={({ ariaLabel }) => (
        <button type="button" aria-label={ariaLabel}>
          Current account
        </button>
      )}
    />,
    { queryClient, features: { education: { enabled: false } } },
  )
}

describe('AccountMenu', () => {
  beforeEach(() => {
    logout.mockResolvedValue({ result: 'success' })
  })

  afterEach(() => vi.restoreAllMocks())

  it('keeps the account identity in the compact trigger accessible name', () => {
    const queryClient = createAccountProfileQueryClient(userProfile)

    renderWithConsoleQuery(<AccountSection compact />, {
      queryClient,
      features: { education: { enabled: false } },
    })

    expect(screen.getByRole('button', { name: accountMenuAccessibleName })).toBeInTheDocument()
    expect(screen.queryByText('Current User')).not.toBeInTheDocument()
  })

  it('reads the signed-in account from the account profile query', async () => {
    const user = userEvent.setup()
    const queryClient = createAccountProfileQueryClient(userProfile)

    renderWithConsoleQuery(<AccountSection />, {
      queryClient,
      features: { education: { enabled: false } },
    })

    expect(screen.getByText('Current User')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: accountMenuAccessibleName }))

    expect(await screen.findByText('current@example.com')).toBeInTheDocument()
  })

  it('keeps the composed trigger disabled in server-rendered markup', () => {
    const html = renderToString(
      <QueryClientProvider client={createAccountProfileQueryClient(userProfile)}>
        <AccountMenu
          trigger={({ ariaLabel }) => (
            <button type="button" aria-label={ariaLabel}>
              Current account
            </button>
          )}
        />
      </QueryClientProvider>,
    )
    const container = document.createElement('div')
    container.innerHTML = html

    expect(
      within(container).getByRole('button', { name: 'accountSettings.account.account' }),
    ).toBeDisabled()
  })

  it('opens preferences from the account menu', async () => {
    const user = userEvent.setup()
    renderAccountMenu()

    await user.click(screen.getByRole('button', { name: 'accountSettings.account.account' }))
    await user.click(await screen.findByText('navigation.settings.preferences'))

    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('preferences'),
    )
  })

  it.each(['main navigation', 'account page', 'education'] as const)(
    'logs out through the shared session boundary from %s',
    async (surface) => {
      const user = userEvent.setup()
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      seedSession()
      if (surface === 'main navigation') {
        renderAccountMenu()
      } else {
        renderWithConsoleQuery(
          surface === 'account page' ? <AccountAvatar /> : <EducationUserInfo />,
          {
            queryClient: createAccountProfileQueryClient(userProfile),
            features: { education: { enabled: false } },
          },
        )
      }
      if (surface !== 'education') {
        await user.click(
          screen.getByRole('button', {
            name:
              surface === 'main navigation' ? 'accountSettings.account.account' : 'Current User',
          }),
        )
      }
      await user.click(
        await screen.findByRole(surface === 'education' ? 'button' : 'menuitem', {
          name: 'common.userProfile.logout',
        }),
      )
      await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith('/signin'))
      expect(logout).toHaveBeenCalledOnce()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
      expect(window.sessionStorage.getItem(OAUTH_REGISTRATION_GA_SENT_KEY)).toBeNull()
    },
  )
})
