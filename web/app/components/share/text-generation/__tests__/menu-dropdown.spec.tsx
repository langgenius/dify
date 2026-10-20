import type { SiteInfo } from '@/models/share'
import type { WebAppAddress } from '@/service/webapp-address'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AccessMode } from '@/models/access-control'
import MenuDropdown from '../menu-dropdown'

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
vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      webAppAccessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
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

describe('MenuDropdown', () => {
  const siteInfo: SiteInfo = { title: 'Test App', icon: '🚀', icon_type: 'emoji' }
  beforeEach(() => {
    mockWebAppLogout.mockResolvedValue(undefined)
  })

  it('exposes the selected theme and keeps the menu open when changing it', async () => {
    const user = userEvent.setup()
    render(<MenuDropdown data={siteInfo} />)
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
      render(<MenuDropdown data={{ ...siteInfo, privacy_policy }} />)
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
    render(<MenuDropdown data={siteInfo} hideLogout />)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    expect(
      screen.queryByRole('menuitem', { name: 'common.userProfile.logout' }),
    ).not.toBeInTheDocument()
  })

  it('logs out of the current web app and redirects back to its sign-in route', async () => {
    const user = userEvent.setup()
    render(<MenuDropdown data={siteInfo} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'common.userProfile.logout' }))
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(`/webapp-signin?redirect_url=${mockPathname}`),
    )
    expect(mockWebAppLogout).toHaveBeenCalledExactlyOnceWith(webAppAddress)
  })

  it('opens app information from the menu and closes the real dialog', async () => {
    const user = userEvent.setup()
    render(<MenuDropdown data={siteInfo} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'common.userProfile.about' }))
    const dialog = await screen.findByRole('dialog', { name: 'Test App' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
