import type { AppContextValue } from '@/context/app-context'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { SystemFeatures } from '@/types/feature'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { Plan } from '../billing/type'
import Header from './index'

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: vi.fn(),
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

// Mock sub-components
vi.mock('./account-dropdown', () => ({ default: () => <div data-testid="account-dropdown" /> }))
vi.mock('./app-nav', () => ({ default: () => <div data-testid="app-nav" /> }))
vi.mock('./dataset-nav', () => ({ default: () => <div data-testid="dataset-nav" /> }))
vi.mock('./env-nav', () => ({ default: () => <div data-testid="env-nav" /> }))
vi.mock('./explore-nav', () => ({ default: ({ className }: { className?: string }) => <div data-testid="explore-nav" className={className} /> }))
vi.mock('./license-env', () => ({ default: () => <div data-testid="license-nav" /> }))
vi.mock('./plan-badge', () => ({ default: ({ onClick }: { onClick: () => void }) => <div data-testid="plan-badge" onClick={onClick} /> }))
vi.mock('./plugins-nav', () => ({ default: () => <div data-testid="plugins-nav" /> }))
vi.mock('./tools-nav', () => ({ default: ({ className }: { className?: string }) => <div data-testid="tools-nav" className={className} /> }))
vi.mock('@/app/components/header/account-dropdown/workplace-selector', () => ({ default: () => <div data-testid="workplace-selector" /> }))
vi.mock('@/context/workspace-context', () => ({ WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children }))

describe('Header', () => {
  const mockSetShowPricingModal = vi.fn()
  const mockSetShowAccountSettingModal = vi.fn()

  beforeEach(() => {
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceDatasetOperator: false,
    } as unknown as AppContextValue)
    vi.mocked(useBreakpoints).mockReturnValue(MediaType.pc)
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: true,
      plan: { type: Plan.sandbox },
    } as unknown as ProviderContextState)
    vi.mocked(useModalContext).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)
    vi.mocked(useGlobalPublicStore).mockReturnValue({
      branding: { enabled: false },
    } as unknown as SystemFeatures)
  })

  it('renders desktop layout by default', () => {
    const { container } = render(<Header />)
    expect(screen.getByTestId('app-nav')).toBeDefined()
    expect(screen.getByTestId('explore-nav')).toBeDefined()
    expect(screen.getByTestId('account-dropdown')).toBeDefined()
    // Should have specific height wrapper in desktop
    expect(container.firstChild).toHaveClass('h-[56px]')
  })

  it('renders mobile layout when media is mobile', () => {
    vi.mocked(useBreakpoints).mockReturnValue(MediaType.mobile)
    const { container } = render(<Header />)
    expect(container.firstChild).not.toHaveClass('h-[56px]')
    expect(screen.getByTestId('app-nav')).toBeDefined()
    expect(screen.getByTestId('account-dropdown')).toBeDefined()
  })

  it('shows branding if enabled', () => {
    vi.mocked(useGlobalPublicStore).mockReturnValue({
      branding: {
        enabled: true,
        application_title: 'Custom Dify',
        workspace_logo: 'logo.png',
      },
    } as unknown as SystemFeatures)
    render(<Header />)
    expect(screen.getByAltText('logo')).toBeDefined()
    expect(screen.getByText('Custom Dify')).toBeDefined()
  })

  it('handles plan click for free plan', () => {
    render(<Header />)
    fireEvent.click(screen.getByTestId('plan-badge'))
    expect(mockSetShowPricingModal).toHaveBeenCalled()
  })

  it('handles plan click for paid plan', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      enableBilling: true,
      plan: { type: Plan.professional },
    } as unknown as ProviderContextState)
    render(<Header />)
    fireEvent.click(screen.getByTestId('plan-badge'))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalled()
  })

  it('hides some nav items for dataset operator', () => {
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceDatasetOperator: true,
    } as unknown as AppContextValue)
    render(<Header />)
    expect(screen.queryByTestId('app-nav')).toBeNull()
    expect(screen.queryByTestId('explore-nav')).toBeNull()
    expect(screen.getByTestId('dataset-nav')).toBeDefined()
  })
})
