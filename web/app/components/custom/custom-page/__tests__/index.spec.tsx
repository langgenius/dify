import type { AppContextValue } from '@/context/app-context'
import type { SystemFeatures } from '@/types/feature'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { contactSalesUrl, defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import {
  initialLangGeniusVersionInfo,
  initialWorkspaceInfo,
  useAppContext,
  userProfilePlaceholder,
} from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { defaultSystemFeatures } from '@/types/feature'
import CustomPage from '../index'

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))
vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))
vi.mock('@/context/app-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/app-context')>()
  return {
    ...actual,
    useAppContext: vi.fn(),
  }
})
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))
vi.mock('@/app/components/base/ui/toast', () => ({
  toast: mockToast,
}))

const mockUseProviderContext = vi.mocked(useProviderContext)
const mockUseModalContext = vi.mocked(useModalContext)
const mockUseAppContext = vi.mocked(useAppContext)
const mockUseGlobalPublicStore = vi.mocked(useGlobalPublicStore)

const createProviderContext = ({
  enableBilling = false,
  planType = Plan.professional,
}: {
  enableBilling?: boolean
  planType?: Plan
} = {}) => {
  return createMockProviderContextValue({
    enableBilling,
    plan: {
      ...defaultPlan,
      type: planType,
    },
  })
}

const createAppContextValue = (): AppContextValue => ({
  userProfile: userProfilePlaceholder,
  mutateUserProfile: vi.fn(),
  currentWorkspace: {
    ...initialWorkspaceInfo,
    custom_config: {
      replace_webapp_logo: 'https://example.com/replace.png',
      remove_webapp_brand: false,
    },
  },
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: false,
  isCurrentWorkspaceEditor: false,
  isCurrentWorkspaceDatasetOperator: false,
  mutateCurrentWorkspace: vi.fn(),
  langGeniusVersionInfo: initialLangGeniusVersionInfo,
  useSelector: vi.fn() as unknown as AppContextValue['useSelector'],
  isLoadingCurrentWorkspace: false,
  isValidatingCurrentWorkspace: false,
})

const createSystemFeatures = (): SystemFeatures => ({
  ...defaultSystemFeatures,
  branding: {
    ...defaultSystemFeatures.branding,
    enabled: true,
    workspace_logo: 'https://example.com/workspace-logo.png',
  },
})

describe('CustomPage', () => {
  const setShowPricingModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseProviderContext.mockReturnValue(createProviderContext())
    mockUseModalContext.mockReturnValue({
      setShowPricingModal,
    } as unknown as ReturnType<typeof useModalContext>)
    mockUseAppContext.mockReturnValue(createAppContextValue())
    mockUseGlobalPublicStore.mockImplementation(selector => selector({
      systemFeatures: createSystemFeatures(),
      setSystemFeatures: vi.fn(),
    }))
  })

  // Integration coverage for the page and its child custom brand section.
  describe('Rendering', () => {
    it('should render the custom brand configuration by default', () => {
      render(<CustomPage />)

      expect(screen.getByText('custom.webapp.removeBrand')).toBeInTheDocument()
      expect(screen.getByText('Chatflow App')).toBeInTheDocument()
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()
    })

    it('should show the upgrade banner and open pricing modal for sandbox billing', async () => {
      const user = userEvent.setup()
      mockUseProviderContext.mockReturnValue(createProviderContext({
        enableBilling: true,
        planType: Plan.sandbox,
      }))

      render(<CustomPage />)

      expect(screen.getByText('custom.upgradeTip.title')).toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()

      await user.click(screen.getByText('billing.upgradeBtn.encourageShort'))

      expect(setShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should show the contact link for professional workspaces', () => {
      mockUseProviderContext.mockReturnValue(createProviderContext({
        enableBilling: true,
        planType: Plan.professional,
      }))

      render(<CustomPage />)

      const contactLink = screen.getByText('custom.customize.contactUs').closest('a')
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(contactLink).toHaveAttribute('href', contactSalesUrl)
      expect(contactLink).toHaveAttribute('target', '_blank')
      expect(contactLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should show the contact link for team workspaces', () => {
      mockUseProviderContext.mockReturnValue(createProviderContext({
        enableBilling: true,
        planType: Plan.team,
      }))

      render(<CustomPage />)

      expect(screen.getByText('custom.customize.contactUs')).toBeInTheDocument()
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
    })

    it('should hide both billing sections when billing is disabled', () => {
      mockUseProviderContext.mockReturnValue(createProviderContext({
        enableBilling: false,
        planType: Plan.sandbox,
      }))

      render(<CustomPage />)

      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()
    })
  })
})
