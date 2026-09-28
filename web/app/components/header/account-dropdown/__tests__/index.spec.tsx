import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import AccountAvatar from '@/app/account/(commonLayout)/avatar'
import { resetUser } from '@/app/components/base/amplitude/utils'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { useLogout } from '@/service/use-common'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AccountDropdown from '../index'

const { mockBasePath, mockResetUser, mockSetSettingsDestination } = vi.hoisted(() => ({
  mockBasePath: { value: '' },
  mockResetUser: vi.fn(),
  mockSetSettingsDestination: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude/utils', () => ({
  resetUser: mockResetUser,
}))

vi.mock('@/service/use-common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-common')>()),
  useLogout: vi.fn(),
}))

vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return mockBasePath.value
  },
}))

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: () => [null, mockSetSettingsDestination],
  }
})

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
    mockBasePath.value = ''
    vi.mocked(useLogout).mockReturnValue({
      mutateAsync: mockLogout,
    } as unknown as ReturnType<typeof useLogout>)
  })

  it('includes the visible account name in the main navigation trigger accessible name', () => {
    const queryClient = createAccountProfileQueryClient(userProfile)

    renderWithConsoleQuery(<AccountSection />, {
      queryClient,
      features: { education: { enabled: false } },
    })

    expect(screen.getByRole('button', { name: accountMenuAccessibleName })).toBeInTheDocument()
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

  it('opens the main navigation account menu through the composed trigger', async () => {
    const user = userEvent.setup()
    renderAccountDropdown()

    const trigger = screen.getByRole('button', { name: 'accountSettings.account.account' })
    expect(trigger).not.toHaveAttribute('data-popup-open')

    await user.click(trigger)

    expect(await screen.findByText('current@example.com')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('data-popup-open', '')
    expect(screen.getByText('navigation.settings.preferences')).toBeInTheDocument()
    expect(screen.getByText('accountSettings.account.appearanceLabel')).toBeInTheDocument()
  })

  it('opens preferences from the account menu', async () => {
    const user = userEvent.setup()
    renderAccountDropdown()

    await user.click(screen.getByRole('button', { name: 'accountSettings.account.account' }))
    await user.click(await screen.findByText('navigation.settings.preferences'))

    expect(mockSetSettingsDestination).toHaveBeenCalledWith('preferences')
  })

  describe.each(['main navigation', 'account page'] as const)('%s logout', (surface) => {
    it.each(['', '/console'])(
      'replaces the document after logout with base path "%s"',
      async (path) => {
        const user = userEvent.setup()
        const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
        mockBasePath.value = path
        let resolveLogout!: () => void
        mockLogout.mockReturnValue(
          new Promise<void>((resolve) => {
            resolveLogout = resolve
          }),
        )

        if (surface === 'main navigation') {
          renderAccountDropdown()
        } else {
          renderWithConsoleQuery(<AccountAvatar />, {
            queryClient: createAccountProfileQueryClient(userProfile),
            features: { education: { enabled: false } },
          })
        }

        await user.click(
          screen.getByRole('button', {
            name:
              surface === 'main navigation' ? 'accountSettings.account.account' : 'Current User',
          }),
        )
        await user.click(await screen.findByRole('menuitem', { name: 'common.userProfile.logout' }))

        expect(mockLogout).toHaveBeenCalledOnce()
        expect(resetUser).not.toHaveBeenCalled()
        expect(replace).not.toHaveBeenCalled()

        await act(async () => resolveLogout())

        await waitFor(() => {
          expect(resetUser).toHaveBeenCalledOnce()
          expect(replace).toHaveBeenCalledExactlyOnceWith(`${path}/signin`)
        })
        replace.mockRestore()
      },
    )
  })
})
