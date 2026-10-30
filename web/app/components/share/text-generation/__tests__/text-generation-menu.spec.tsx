import type { WebAppEntryState } from '../../webapp-entry'
import type { SiteInfo } from '@/models/share'
import type { WebAppAddress } from '@/service/webapp-address'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AccessMode } from '@/models/access-control'
import TextGenerationMenu from '../text-generation-menu'

const mockSetTheme = vi.fn()
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme: mockSetTheme }) }))

const mockReplace = vi.fn()
const mockPathname = '/test-path'
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => mockPathname,
}))

const mockShareCode = 'test-share-code'
const webAppAddress: WebAppAddress = { kind: 'default', code: mockShareCode }
const authenticatedEntry: WebAppEntryState = {
  status: 'ready',
  account: 'authenticated',
  parameters: {
    account_login_enabled: true,
    account_login_url: '/signin',
    allow_anonymous_end_user_auth: true,
    connection_revision: null,
    requires_end_user_connections: false,
    connection_requirements: [],
  },
  canRun: true,
  showSignIn: false,
}
let mockAccessMode: AccessMode = AccessMode.SPECIFIC_GROUPS_MEMBERS
let mockEntry: WebAppEntryState | null = null
vi.mock('../../webapp-entry', () => ({
  useWebAppEntry: () => mockEntry,
}))
vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      webAppAccessMode: mockAccessMode,
      shareCode: mockShareCode,
    }
    return selector(state)
  },
}))

const mockWebAppLogout = vi.fn().mockResolvedValue(undefined)
vi.mock('@/service/webapp-auth', () => ({
  webAppLogout: (...args: unknown[]) => mockWebAppLogout(...args),
}))

vi.mock('@/service/webapp-address', () => ({
  resolveWebAppAddress: () => webAppAddress,
}))

describe('TextGenerationMenu', () => {
  const siteInfo: SiteInfo = { title: 'Test App', icon: '🚀', icon_type: 'emoji' }
  beforeEach(() => {
    mockWebAppLogout.mockResolvedValue(undefined)
    mockAccessMode = AccessMode.SPECIFIC_GROUPS_MEMBERS
    mockEntry = null
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the selected theme and keeps the menu open when changing it', async () => {
    const user = userEvent.setup()
    render(<TextGenerationMenu data={siteInfo} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    expect(screen.getByRole('menuitemradio', { name: 'common.theme.auto' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'common.theme.light' }))
    expect(mockSetTheme).toHaveBeenCalledWith('light', expect.anything())
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it.each([undefined, 'https://example.com/privacy'])(
    'only links to a configured privacy policy (%s)',
    async (privacy_policy) => {
      const user = userEvent.setup()
      render(<TextGenerationMenu data={{ ...siteInfo, privacy_policy }} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      const link = screen.queryByRole('menuitem', { name: 'share.chat.privacyPolicyMiddle' })
      if (privacy_policy) {
        expect(link).toHaveAttribute('href', privacy_policy)
        expect(link).toHaveAttribute('target', '_blank')
      } else {
        expect(link).not.toBeInTheDocument()
      }
    },
  )

  it('hides logout when requested', async () => {
    const user = userEvent.setup()
    render(<TextGenerationMenu data={siteInfo} hideLogout />)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    expect(
      screen.queryByRole('menuitem', { name: 'common.userProfile.logout' }),
    ).not.toBeInTheDocument()
  })

  it('logs out of the current web app and redirects back to its sign-in route', async () => {
    const user = userEvent.setup()
    render(<TextGenerationMenu data={siteInfo} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'common.userProfile.logout' }))
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(`/webapp-signin?redirect_url=${mockPathname}`),
    )
    expect(mockWebAppLogout).toHaveBeenCalledExactlyOnceWith(webAppAddress)
  })

  it.each([AccessMode.PUBLIC, AccessMode.EXTERNAL_MEMBERS])(
    'keeps logout hidden for legacy %s access without an account entry',
    async (accessMode) => {
      const user = userEvent.setup()
      mockAccessMode = accessMode

      render(<TextGenerationMenu data={siteInfo} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      expect(
        screen.queryByRole('menuitem', { name: 'common.userProfile.logout' }),
      ).not.toBeInTheDocument()
    },
  )

  it('lets an authenticated personal account log out of a public app and reloads after logout', async () => {
    const user = userEvent.setup()
    mockAccessMode = AccessMode.PUBLIC
    mockEntry = authenticatedEntry
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    let finishLogout!: () => void
    mockWebAppLogout.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLogout = resolve
        }),
    )

    render(<TextGenerationMenu data={siteInfo} />)
    const accountMenu = screen.getByRole('button', { name: 'Joel' })
    expect(accountMenu).toHaveTextContent('Joel')
    expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
    await user.click(accountMenu)
    await user.click(screen.getByRole('menuitem', { name: 'common.userProfile.logout' }))
    expect(mockWebAppLogout).toHaveBeenCalledExactlyOnceWith(webAppAddress)
    expect(reload).not.toHaveBeenCalled()

    finishLogout()
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('honors hideLogout for an authenticated personal account', async () => {
    const user = userEvent.setup()
    mockAccessMode = AccessMode.PUBLIC
    mockEntry = authenticatedEntry

    render(<TextGenerationMenu data={siteInfo} hideLogout />)
    await user.click(screen.getByRole('button', { name: 'Joel' }))
    expect(
      screen.queryByRole('menuitem', { name: 'common.userProfile.logout' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the settings trigger for an anonymous personal account', async () => {
    const user = userEvent.setup()
    mockAccessMode = AccessMode.PUBLIC
    mockEntry = { ...authenticatedEntry, account: 'anonymous', showSignIn: true }

    render(<TextGenerationMenu data={siteInfo} />)
    expect(screen.queryByRole('button', { name: 'Joel' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    expect(
      screen.queryByRole('menuitem', { name: 'common.userProfile.logout' }),
    ).not.toBeInTheDocument()
  })

  it('opens app information from the menu and closes the real dialog', async () => {
    const user = userEvent.setup()
    render(<TextGenerationMenu data={siteInfo} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'common.userProfile.about' }))
    const dialog = await screen.findByRole('dialog', { name: 'Test App' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
