import type { ReactElement } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import Header from '../index'

function createMockComponent(testId: string) {
  return () => <div data-testid={testId} />
}

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
  PlanBadge: ({ onClick, plan }: { onClick?: () => void, plan?: string }) => (
    <button data-testid="plan-badge" onClick={onClick} data-plan={plan} />
  ),
}))

vi.mock('@/context/workspace-context-provider', () => ({
  WorkspaceProvider: ({ children }: { children?: React.ReactNode }) => children,
}))

vi.mock('@/next/link', () => ({
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

const renderHeader = (ui: ReactElement = <Header />) =>
  renderWithSystemFeatures(ui, {
    systemFeatures: {
      branding: {
        enabled: mockBrandingEnabled,
        application_title: mockBrandingTitle ?? '',
        workspace_logo: mockBrandingLogo ?? '',
      },
    },
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
    renderHeader()

    expect(screen.getByRole('img', { name: /dify logo/i })).toBeInTheDocument()
    expect(screen.getByTestId('workplace-selector')).toBeInTheDocument()
    expect(screen.getByTestId('app-nav')).toBeInTheDocument()
    expect(screen.getByTestId('account-dropdown')).toBeInTheDocument()
  })

  it('should show license nav when billing disabled, plan badge when enabled', () => {
    mockEnableBilling = false
    const { rerender } = renderHeader()
    expect(screen.getByTestId('license-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-badge')).not.toBeInTheDocument()

    mockEnableBilling = true
    rerender(<Header />)
    expect(screen.queryByTestId('license-nav')).not.toBeInTheDocument()
    expect(screen.getByTestId('plan-badge')).toBeInTheDocument()
  })

  it('should hide explore nav when user is dataset operator', () => {
    mockIsDatasetOperator = true
    renderHeader()

    expect(screen.queryByTestId('explore-nav')).not.toBeInTheDocument()
    expect(screen.getByTestId('dataset-nav')).toBeInTheDocument()
  })

  it('should call pricing modal for free plan, settings modal for paid plan', () => {
    mockEnableBilling = true
    mockPlanType = 'sandbox'
    const { rerender } = renderHeader()

    fireEvent.click(screen.getByTestId('plan-badge'))
    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)

    mockPlanType = 'professional'
    rerender(<Header />)
    fireEvent.click(screen.getByTestId('plan-badge'))
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledTimes(1)
  })

  it('should render mobile layout without env nav', () => {
    mockMedia = 'mobile'
    renderHeader()

    expect(screen.getByRole('img', { name: /dify logo/i })).toBeInTheDocument()
    expect(screen.queryByTestId('env-nav')).not.toBeInTheDocument()
  })

  it('should render branded title and logo when branding is enabled', () => {
    mockBrandingEnabled = true
    mockBrandingTitle = 'Acme Workspace'
    mockBrandingLogo = '/logo.png'

    renderHeader()

    expect(screen.getByText('Acme Workspace')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /logo/i })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /dify logo/i })).not.toBeInTheDocument()
  })

  it('should show default Dify logo when branding is enabled but no workspace_logo', () => {
    mockBrandingEnabled = true
    mockBrandingTitle = 'Custom Title'
    mockBrandingLogo = null

    renderHeader()

    expect(screen.getByText('Custom Title')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /dify logo/i })).toBeInTheDocument()
  })

  it('should show default Dify text when branding enabled but no application_title', () => {
    mockBrandingEnabled = true
    mockBrandingTitle = null
    mockBrandingLogo = null

    renderHeader()

    expect(screen.getByText('Dify')).toBeInTheDocument()
  })

  it('should show dataset nav for editor who is not dataset operator', () => {
    mockIsWorkspaceEditor = true
    mockIsDatasetOperator = false

    renderHeader()

    expect(screen.getByTestId('dataset-nav')).toBeInTheDocument()
    expect(screen.getByTestId('explore-nav')).toBeInTheDocument()
    expect(screen.getByTestId('app-nav')).toBeInTheDocument()
  })

  it('should hide dataset nav when neither editor nor dataset operator', () => {
    mockIsWorkspaceEditor = false
    mockIsDatasetOperator = false

    renderHeader()

    expect(screen.queryByTestId('dataset-nav')).not.toBeInTheDocument()
  })

  it('should render mobile layout with dataset operator nav restrictions', () => {
    mockMedia = 'mobile'
    mockIsDatasetOperator = true

    renderHeader()

    expect(screen.queryByTestId('explore-nav')).not.toBeInTheDocument()
    expect(screen.queryByTestId('app-nav')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tools-nav')).not.toBeInTheDocument()
    expect(screen.getByTestId('dataset-nav')).toBeInTheDocument()
  })

  it('should render mobile layout with billing enabled', () => {
    mockMedia = 'mobile'
    mockEnableBilling = true
    mockPlanType = 'sandbox'

    renderHeader()

    expect(screen.getByTestId('plan-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('license-nav')).not.toBeInTheDocument()
  })
})
