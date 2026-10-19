import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import AccountAvatar from '@/app/account/(commonLayout)/avatar'
import AccountSection from '@/app/components/main-nav/components/account-section'
import EducationUserInfo from '@/app/education/user-info'
import { useLogout } from '@/service/use-common'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { renderWithConsoleQuery as renderWithConsoleQueryWithoutUrlState } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import AccountDropdown from '../index'

vi.mock('@/service/use-common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-common')>()),
  useLogout: vi.fn(),
}))

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

const renderAccountDropdown = () => {
  const queryClient = createAccountProfileQueryClient(userProfile)

  return renderWithConsoleQuery(
    <AccountDropdown
      trigger={({ ariaLabel }) => (
        <button type="button" aria-label={ariaLabel}>
          Current account
        </button>
      )}
    />,
    { queryClient, features: { education: { enabled: false } } },
  )
}

describe('AccountDropdown', () => {
  const mockLogout = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useLogout).mockReturnValue({
      mutate: mockLogout,
    } as unknown as ReturnType<typeof useLogout>)
  })

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
      <AccountDropdown
        trigger={({ ariaLabel }) => (
          <button type="button" aria-label={ariaLabel}>
            Current account
          </button>
        )}
      />,
    )
    const container = document.createElement('div')
    container.innerHTML = html

    expect(
      container.querySelector('button[aria-label="accountSettings.account.account"]'),
    ).toBeDisabled()
  })

  it('opens preferences from the account menu', async () => {
    const user = userEvent.setup()
    renderAccountDropdown()

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
      if (surface === 'main navigation') {
        renderAccountDropdown()
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
      expect(mockLogout).toHaveBeenCalledExactlyOnceWith()
    },
  )
})
