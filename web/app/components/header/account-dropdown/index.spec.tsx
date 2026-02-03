import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { AppContextValue } from '@/context/app-context'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useLogout } from '@/service/use-common'
import AppSelector from './index'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

// Mock sub-components
vi.mock('../account-about', () => ({ default: () => <div data-testid="account-about" /> }))
vi.mock('../github-star', () => ({ default: () => <div data-testid="github-star" /> }))
vi.mock('../indicator', () => ({ default: () => <div data-testid="indicator" /> }))
vi.mock('./compliance', () => ({ default: () => <div data-testid="compliance" /> }))
vi.mock('./support', () => ({ default: () => <div data-testid="support" /> }))

describe('AccountDropdown', () => {
  const mockPush = vi.fn()
  const mockLogout = vi.fn()
  const mockSetShowAccountSettingModal = vi.fn()

  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
    } as unknown as AppRouterInstance)
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
    vi.mocked(useGlobalPublicStore).mockReturnValue({
      systemFeatures: { branding: { enabled: false } },
    } as unknown as ReturnType<typeof useGlobalPublicStore>)
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
    render(<AppSelector />)
    // Headless UI Menu might not be open by default, so we need to click it
    const avatar = screen.getByRole('button')
    fireEvent.click(avatar)

    expect(screen.getByText('Test User')).toBeDefined()
    expect(screen.getByText('test@example.com')).toBeDefined()
  })

  it('shows EDU badge for education accounts', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      isEducationAccount: true,
    } as unknown as ProviderContextState)
    render(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('EDU')).toBeDefined()
  })

  it('triggers setShowAccountSettingModal when settings is clicked', () => {
    render(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('userProfile.settings'))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalled()
  })

  it('handles logout correctly', async () => {
    mockLogout.mockResolvedValue({})
    render(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('userProfile.logout'))

    expect(mockLogout).toHaveBeenCalled()
  })

  it('shows About section when about button is clicked', () => {
    render(<AppSelector />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('userProfile.about'))
    expect(screen.getByTestId('account-about')).toBeDefined()
  })
})
