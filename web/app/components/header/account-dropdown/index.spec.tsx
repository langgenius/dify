import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { AppContextValue } from '@/context/app-context'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useLogout } from '@/service/use-common'
import AppSelector from './index'

// Mock local contexts and services
vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude/utils', () => ({
  resetUser: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

// Mock sub-components with prop tracking
type AccountAboutProps = {
  onCancel: () => void
}
vi.mock('../account-about', () => ({
  default: ({ onCancel }: AccountAboutProps) => (
    <div data-testid="account-about">
      <button onClick={onCancel} data-testid="about-cancel">Cancel</button>
    </div>
  ),
}))
vi.mock('../github-star', () => ({ default: () => <div data-testid="github-star" /> }))
type IndicatorProps = {
  color?: string
}
vi.mock('../indicator', () => ({
  default: ({ color }: IndicatorProps) => <div data-testid="indicator" data-color={color} />,
}))
vi.mock('./compliance', () => ({ default: () => <div data-testid="compliance" /> }))
vi.mock('./support', () => ({ default: () => <div data-testid="support" /> }))

// Mock config and env
const { mockConfig, mockEnv } = vi.hoisted(() => ({
  mockConfig: {
    IS_CLOUD_EDITION: false,
  },
  mockEnv: {
    env: {
      NEXT_PUBLIC_SITE_ABOUT: 'show',
    },
  },
}))
vi.mock('@/config', () => mockConfig)
vi.mock('@/env', () => mockEnv)

describe('AccountDropdown', () => {
  const mockPush = vi.fn()
  const mockLogout = vi.fn()
  const mockSetShowAccountSettingModal = vi.fn()

  const renderWithRouter = (ui: React.ReactElement) => {
    const mockRouter = {
      push: mockPush,
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    } as unknown as AppRouterInstance

    return render(
      <AppRouterContext.Provider value={mockRouter}>
        {ui}
      </AppRouterContext.Provider>,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.IS_CLOUD_EDITION = false
    mockEnv.env.NEXT_PUBLIC_SITE_ABOUT = 'show'

    vi.mocked(useAppContext).mockReturnValue({
      userProfile: {
        name: 'Test User',
        email: 'test@example.com',
        avatar_url: 'avatar.png',
      },
      langGeniusVersionInfo: {
        current_version: '0.6.0',
        latest_version: '0.6.0',
      },
      isCurrentWorkspaceOwner: true,
    } as unknown as AppContextValue)
    vi.mocked(useGlobalPublicStore).mockImplementation((selector?: unknown) => {
      const fullState = { systemFeatures: { branding: { enabled: false } }, setSystemFeatures: vi.fn() }
      return typeof selector === 'function' ? (selector as (state: typeof fullState) => unknown)(fullState) : fullState
    })
    vi.mocked(useProviderContext).mockReturnValue({
      isEducationAccount: false,
    } as unknown as ProviderContextState)
    vi.mocked(useModalContext).mockReturnValue({
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)
    vi.mocked(useLogout).mockReturnValue({
      mutateAsync: mockLogout,
    } as unknown as ReturnType<typeof useLogout>)
  })

  it('renders user profile correctly', () => {
    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Test User')).toBeDefined()
    expect(screen.getByText('test@example.com')).toBeDefined()
  })

  it('shows EDU badge for education accounts', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      isEducationAccount: true,
    } as unknown as ProviderContextState)
    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('EDU')).toBeDefined()
  })

  it('triggers setShowAccountSettingModal when settings is clicked', () => {
    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('common.userProfile.settings'))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalled()
  })

  it('handles logout correctly', async () => {
    mockLogout.mockResolvedValue({})
    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('common.userProfile.logout'))

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled()
      // In vitest.setup.ts, localStorage.removeItem is already vi.fn()
      expect(localStorage.removeItem).toHaveBeenCalledWith('setup_status')
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })
  })

  it('shows About section when about button is clicked and can close it', () => {
    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('common.userProfile.about'))
    expect(screen.getByTestId('account-about')).toBeDefined()

    fireEvent.click(screen.getByTestId('about-cancel'))
    expect(screen.queryByTestId('account-about')).toBeNull()
  })

  it('hides sections when branding is enabled', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation((selector?: unknown) => {
      const fullState = { systemFeatures: { branding: { enabled: true } }, setSystemFeatures: vi.fn() }
      return typeof selector === 'function' ? (selector as (state: typeof fullState) => unknown)(fullState) : fullState
    })
    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.queryByText('common.userProfile.helpCenter')).toBeNull()
    expect(screen.queryByText('common.userProfile.roadmap')).toBeNull()
  })

  it('shows Compliance in Cloud Edition for workspace owner', () => {
    mockConfig.IS_CLOUD_EDITION = true
    vi.mocked(useAppContext).mockReturnValue({
      userProfile: { name: 'User' },
      isCurrentWorkspaceOwner: true,
      langGeniusVersionInfo: { current_version: '0.6.0', latest_version: '0.6.0' },
    } as unknown as AppContextValue)

    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('compliance')).toBeDefined()
  })

  it('hides Compliance in Cloud Edition for non-owner', () => {
    mockConfig.IS_CLOUD_EDITION = true
    vi.mocked(useAppContext).mockReturnValue({
      userProfile: { name: 'User' },
      isCurrentWorkspaceOwner: false,
      langGeniusVersionInfo: { current_version: '0.6.0', latest_version: '0.6.0' },
    } as unknown as AppContextValue)

    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByTestId('compliance')).toBeNull()
  })

  it('hides Compliance in non-Cloud Edition for owner', () => {
    mockConfig.IS_CLOUD_EDITION = false
    vi.mocked(useAppContext).mockReturnValue({
      userProfile: { name: 'User' },
      isCurrentWorkspaceOwner: true,
      langGeniusVersionInfo: { current_version: '0.6.0', latest_version: '0.6.0' },
    } as unknown as AppContextValue)

    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByTestId('compliance')).toBeNull()
  })

  it('hides About section when NEXT_PUBLIC_SITE_ABOUT is hide', () => {
    mockEnv.env.NEXT_PUBLIC_SITE_ABOUT = 'hide'
    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('common.userProfile.about')).toBeNull()
  })

  it('shows orange indicator when version is not latest', () => {
    vi.mocked(useAppContext).mockReturnValue({
      userProfile: { name: 'User' },
      langGeniusVersionInfo: {
        current_version: '0.6.0',
        latest_version: '0.7.0',
      },
    } as unknown as AppContextValue)
    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))

    const indicator = screen.getByTestId('indicator')
    expect(indicator.getAttribute('data-color')).toBe('orange')
  })

  it('shows green indicator when version is latest', () => {
    vi.mocked(useAppContext).mockReturnValue({
      userProfile: { name: 'User' },
      langGeniusVersionInfo: {
        current_version: '0.7.0',
        latest_version: '0.7.0',
      },
    } as unknown as AppContextValue)
    renderWithRouter(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))

    const indicator = screen.getByTestId('indicator')
    expect(indicator.getAttribute('data-color')).toBe('green')
  })
})
