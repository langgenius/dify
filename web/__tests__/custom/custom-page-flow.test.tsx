import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { contactSalesUrl, defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import CustomPage from '@/app/components/custom/custom-page'
import useWebAppBrand from '@/app/components/custom/custom-web-app-brand/hooks/use-web-app-brand'

const mockSetShowPricingModal = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowPricingModal: mockSetShowPricingModal,
  }),
}))

vi.mock('@/app/components/custom/custom-web-app-brand/hooks/use-web-app-brand', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const { useProviderContext } = await import('@/context/provider-context')

const mockUseProviderContext = vi.mocked(useProviderContext)
const mockUseWebAppBrand = vi.mocked(useWebAppBrand)

const createBrandState = (overrides: Partial<ReturnType<typeof useWebAppBrand>> = {}): ReturnType<typeof useWebAppBrand> => ({
  fileId: '',
  imgKey: 1,
  uploadProgress: 0,
  uploading: false,
  webappLogo: 'https://example.com/logo.png',
  webappBrandRemoved: false,
  uploadDisabled: false,
  workspaceLogo: 'https://example.com/workspace-logo.png',
  isCurrentWorkspaceManager: true,
  isSandbox: false,
  handleApply: vi.fn(),
  handleCancel: vi.fn(),
  handleChange: vi.fn(),
  handleRestore: vi.fn(),
  handleSwitch: vi.fn(),
  ...overrides,
})

const setProviderPlan = (planType: Plan, enableBilling = true) => {
  mockUseProviderContext.mockReturnValue(createMockProviderContextValue({
    enableBilling,
    plan: {
      ...defaultPlan,
      type: planType,
    },
  }))
}

describe('Custom Page Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setProviderPlan(Plan.professional)
    mockUseWebAppBrand.mockReturnValue(createBrandState())
  })

  it('shows the billing upgrade banner for sandbox workspaces and opens pricing modal', () => {
    setProviderPlan(Plan.sandbox)

    render(<CustomPage />)

    expect(screen.getByText('custom.upgradeTip.title')).toBeInTheDocument()
    expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('billing.upgradeBtn.encourageShort'))

    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
  })

  it('renders the branding controls and the sales contact footer for paid workspaces', () => {
    const hookState = createBrandState({
      fileId: 'pending-logo',
    })
    mockUseWebAppBrand.mockReturnValue(hookState)

    render(<CustomPage />)

    const contactLink = screen.getByText('custom.customize.contactUs').closest('a')
    expect(contactLink).toHaveAttribute('href', contactSalesUrl)

    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'custom.restore' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'custom.apply' }))

    expect(hookState.handleSwitch).toHaveBeenCalledWith(true)
    expect(hookState.handleRestore).toHaveBeenCalledTimes(1)
    expect(hookState.handleCancel).toHaveBeenCalledTimes(1)
    expect(hookState.handleApply).toHaveBeenCalledTimes(1)
  })
})
