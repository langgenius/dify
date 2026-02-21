import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import Header from './index'

function createMockComponent(testId: string) {
  return () => <div data-testid={testId} />
}

vi.mock('@/app/components/base/logo/dify-logo', () => ({
  default: createMockComponent('dify-logo'),
}))

vi.mock('@/app/components/header/account-dropdown/workplace-selector', () => ({
  default: createMockComponent('workplace-selector'),
}))

vi.mock('@/app/components/header/account-dropdown', () => ({
  default: createMockComponent('account-dropdown'),
}))

vi.mock('@/app/components/header/app-nav', () => ({
  default: createMockComponent('app-nav'),
}))

vi.mock('@/app/components/header/dataset-nav', () => ({
  default: createMockComponent('dataset-nav'),
}))

vi.mock('@/app/components/header/env-nav', () => ({
  default: createMockComponent('env-nav'),
}))

vi.mock('@/app/components/header/explore-nav', () => ({
  default: createMockComponent('explore-nav'),
}))

vi.mock('@/app/components/header/license-env', () => ({
  default: createMockComponent('license-nav'),
}))

vi.mock('@/app/components/header/plugins-nav', () => ({
  default: createMockComponent('plugins-nav'),
}))

vi.mock('@/app/components/header/tools-nav', () => ({
  default: createMockComponent('tools-nav'),
}))

vi.mock('@/app/components/header/plan-badge', () => ({
  default: ({ onClick, plan }: { onClick?: () => void, plan?: string }) => (
    <button data-testid="plan-badge" onClick={onClick} data-plan={plan} />
  ),
}))

vi.mock('@/context/workspace-context', () => ({
  WorkspaceProvider: ({ children }: { children?: React.ReactNode }) => children,
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode, href?: string }) => <a href={href}>{children}</a>,
}))

let mockIsWorkspaceEditor = false
let mockIsDatasetOperator = false
let mockMedia = 'desktop'
let mockEnableBilling = false
let mockPlanType = 'sandbox'
let mockBrandingEnabled = false
let mockBrandingTitle: string | null = null
let mockBrandingLogo: string | null = null
const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsWorkspaceEditor,
    isCurrentWorkspaceDatasetOperator: mockIsDatasetOperator,
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => mockMedia,
  MediaType: { mobile: 'mobile', tablet: 'tablet', desktop: 'desktop' },
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableBilling: mockEnableBilling,
    plan: { type: mockPlanType },
  }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowPricingModal: mockSetShowPricingModal,
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

vi.mock('@/context/global-public-context', () => {
  type SystemFeatures = { branding: { enabled: boolean, application_title: string | null, workspace_logo: string | null } }
  return {
    useGlobalPublicStore: (selector: (s: { systemFeatures: SystemFeatures }) => SystemFeatures) =>
      selector({
        systemFeatures: {
          branding: {
            enabled: mockBrandingEnabled,
            application_title: mockBrandingTitle,
            workspace_logo: mockBrandingLogo,
          },
        },
      }),
  }
})

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsWorkspaceEditor = false
    mockIsDatasetOperator = false
    mockMedia = 'desktop'
    mockEnableBilling = false
    mockPlanType = 'sandbox'
    mockBrandingEnabled = false
    mockBrandingTitle = null
    mockBrandingLogo = null
  })

  it('should render header with main nav components', () => {
    render(<Header />)

    expect(screen.getByTestId('dify-logo')).toBeInTheDocument()
    expect(screen.getByTestId('workplace-selector')).toBeInTheDocument()
    expect(screen.getByTestId('app-nav')).toBeInTheDocument()
    expect(screen.getByTestId('account-dropdown')).toBeInTheDocument()
  })

  it('should show license nav when billing disabled, plan badge when enabled', () => {
    mockEnableBilling = false
    const { rerender } = render(<Header />)
    expect(screen.getByTestId('license-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-badge')).not.toBeInTheDocument()

    mockEnableBilling = true
    rerender(<Header />)
    expect(screen.queryByTestId('license-nav')).not.toBeInTheDocument()
    expect(screen.getByTestId('plan-badge')).toBeInTheDocument()
  })

  it('should hide explore nav when user is dataset operator', () => {
    mockIsDatasetOperator = true
    render(<Header />)

    expect(screen.queryByTestId('explore-nav')).not.toBeInTheDocument()
    expect(screen.getByTestId('dataset-nav')).toBeInTheDocument()
  })

  it('should call pricing modal for free plan, settings modal for paid plan', () => {
    mockEnableBilling = true
    mockPlanType = 'sandbox'
    const { rerender } = render(<Header />)

    fireEvent.click(screen.getByTestId('plan-badge'))
    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)

    mockPlanType = 'professional'
    rerender(<Header />)
    fireEvent.click(screen.getByTestId('plan-badge'))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledTimes(1)
  })

  it('should render mobile layout without env nav', () => {
    mockMedia = 'mobile'
    render(<Header />)

    expect(screen.getByTestId('dify-logo')).toBeInTheDocument()
    expect(screen.queryByTestId('env-nav')).not.toBeInTheDocument()
  })

  it('should render branded title and logo when branding is enabled', () => {
    mockBrandingEnabled = true
    mockBrandingTitle = 'Acme Workspace'
    mockBrandingLogo = '/logo.png'

    render(<Header />)

    expect(screen.getByText('Acme Workspace')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /logo/i })).toBeInTheDocument()
    expect(screen.queryByTestId('dify-logo')).not.toBeInTheDocument()
  })
})
