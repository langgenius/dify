import type { ProviderContextState } from '@/context/provider-context'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { resetUser } from '@/app/components/base/amplitude/utils'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { useProviderContext } from '@/context/provider-context'
import { useLogout } from '@/service/use-common'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AccountDropdown from '../index'

const { mockPush, mockResetUser, mockSetSettingsDestination, mockUseRouter } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockResetUser: vi.fn(),
  mockSetSettingsDestination: vi.fn(),
  mockUseRouter: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude/utils', () => ({
  resetUser: mockResetUser,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/service/use-common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-common')>()),
  useLogout: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    useRouter: mockUseRouter,
  }
})

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
    { queryClient },
  )
}

describe('AccountDropdown', () => {
  const mockLogout = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRouter.mockReturnValue({ push: mockPush })
    vi.mocked(useProviderContext).mockReturnValue({
      enableEducationPlan: false,
    } as ProviderContextState)
    vi.mocked(useLogout).mockReturnValue({
      mutateAsync: mockLogout,
    } as unknown as ReturnType<typeof useLogout>)
  })

  it('reads the signed-in account from the account profile query', async () => {
    const user = userEvent.setup()
    const queryClient = createAccountProfileQueryClient(userProfile)

    renderWithConsoleQuery(<AccountSection />, { queryClient })

    expect(screen.getByText('Current User')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.account.account' }))

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

    expect(container.querySelector('button[aria-label="common.account.account"]')).toBeDisabled()
  })

  it('opens the main navigation account menu through the composed trigger', async () => {
    const user = userEvent.setup()
    renderAccountDropdown()

    const trigger = screen.getByRole('button', { name: 'common.account.account' })
    expect(trigger).not.toHaveAttribute('data-popup-open')

    await user.click(trigger)

    expect(await screen.findByText('current@example.com')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('data-popup-open', '')
    expect(screen.getByText('common.settings.preferences')).toBeInTheDocument()
    expect(screen.getByText('common.account.appearanceLabel')).toBeInTheDocument()
  })

  it('opens preferences from the account menu', async () => {
    const user = userEvent.setup()
    renderAccountDropdown()

    await user.click(screen.getByRole('button', { name: 'common.account.account' }))
    await user.click(await screen.findByText('common.settings.preferences'))

    expect(mockSetSettingsDestination).toHaveBeenCalledWith('preferences')
  })

  it('logs out and redirects to sign in', async () => {
    mockLogout.mockResolvedValue({})
    renderAccountDropdown()

    fireEvent.click(screen.getByRole('button', { name: 'common.account.account' }))
    fireEvent.click(await screen.findByText('common.userProfile.logout'))

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledOnce()
      expect(resetUser).toHaveBeenCalledOnce()
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })
  })
})
