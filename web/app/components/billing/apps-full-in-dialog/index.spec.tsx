import type { Mock } from 'vitest'
import type { UsagePlanInfo } from '@/app/components/billing/type'
import type { AppContextValue } from '@/context/app-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { ICurrentWorkspace, LangGeniusVersionResponse, UserProfileResponse } from '@/models/common'
import { render, screen } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { mailToSupport } from '@/app/components/header/utils/util'
import { useAppContext } from '@/context/app-context'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import AppsFull from './index'

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: vi.fn(),
  }
})

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowPricingModal: vi.fn(),
  }),
}))

vi.mock('@/app/components/header/utils/util', () => ({
  mailToSupport: vi.fn(),
}))

const buildUsage = (overrides: Partial<UsagePlanInfo> = {}): UsagePlanInfo => ({
  buildApps: 0,
  teamMembers: 0,
  annotatedResponse: 0,
  documentsUploadQuota: 0,
  apiRateLimit: 0,
  triggerEvents: 0,
  vectorSpace: 0,
  ...overrides,
})

const buildProviderContext = (overrides: Partial<ProviderContextState> = {}): ProviderContextState => ({
  ...baseProviderContextValue,
  plan: {
    ...baseProviderContextValue.plan,
    type: Plan.sandbox,
    usage: buildUsage({ buildApps: 2 }),
    total: buildUsage({ buildApps: 10 }),
    reset: {
      apiRateLimit: null,
      triggerEvents: null,
    },
  },
  ...overrides,
})

const buildAppContext = (overrides: Partial<AppContextValue> = {}): AppContextValue => {
  const userProfile: UserProfileResponse = {
    id: 'user-id',
    name: 'Test User',
    email: 'user@example.com',
    avatar: '',
    avatar_url: '',
    is_password_set: false,
  }
  const currentWorkspace: ICurrentWorkspace = {
    id: 'workspace-id',
    name: 'Workspace',
    plan: '',
    status: '',
    created_at: 0,
    role: 'normal',
    providers: [],
    trial_credits: 200,
    trial_credits_used: 0,
    next_credit_reset_date: 0,
  }
  const langGeniusVersionInfo: LangGeniusVersionResponse = {
    current_env: '',
    current_version: '1.0.0',
    latest_version: '',
    release_date: '',
    release_notes: '',
    version: '',
    can_auto_update: false,
  }
  const base: Omit<AppContextValue, 'useSelector'> = {
    userProfile,
    currentWorkspace,
    isCurrentWorkspaceManager: false,
    isCurrentWorkspaceOwner: false,
    isCurrentWorkspaceEditor: false,
    isCurrentWorkspaceDatasetOperator: false,
    mutateUserProfile: vi.fn(),
    mutateCurrentWorkspace: vi.fn(),
    langGeniusVersionInfo,
    isLoadingCurrentWorkspace: false,
    isValidatingCurrentWorkspace: false,
  }
  const useSelector: AppContextValue['useSelector'] = selector => selector({ ...base, useSelector })
  return {
    ...base,
    useSelector,
    ...overrides,
  }
}

describe('AppsFull', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useProviderContext as Mock).mockReturnValue(buildProviderContext())
    ;(useAppContext as Mock).mockReturnValue(buildAppContext())
    ;(mailToSupport as Mock).mockReturnValue('mailto:support@example.com')
  })

  // Rendering behavior for non-team plans.
  describe('Rendering', () => {
    it('should render the sandbox messaging and upgrade button', () => {
      // Act
      render(<AppsFull loc="billing_dialog" />)

      // Assert
      expect(screen.getByText('billing.apps.fullTip1')).toBeInTheDocument()
      expect(screen.getByText('billing.apps.fullTip1des')).toBeInTheDocument()
      expect(screen.getByText('billing.upgradeBtn.encourageShort')).toBeInTheDocument()
      expect(screen.getByText('2/10')).toBeInTheDocument()
    })
  })

  // Prop-driven behavior for team plans and contact CTA.
  describe('Props', () => {
    it('should render team messaging and contact button for non-sandbox plans', () => {
      // Arrange
      ;(useProviderContext as Mock).mockReturnValue(buildProviderContext({
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.team,
          usage: buildUsage({ buildApps: 8 }),
          total: buildUsage({ buildApps: 10 }),
          reset: {
            apiRateLimit: null,
            triggerEvents: null,
          },
        },
      }))
      render(<AppsFull loc="billing_dialog" />)

      // Assert
      expect(screen.getByText('billing.apps.fullTip2')).toBeInTheDocument()
      expect(screen.getByText('billing.apps.fullTip2des')).toBeInTheDocument()
      expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'billing.apps.contactUs' })).toHaveAttribute('href', 'mailto:support@example.com')
      expect(mailToSupport).toHaveBeenCalledWith('user@example.com', Plan.team, '1.0.0')
    })

    it('should render upgrade button for professional plans', () => {
      // Arrange
      ;(useProviderContext as Mock).mockReturnValue(buildProviderContext({
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.professional,
          usage: buildUsage({ buildApps: 4 }),
          total: buildUsage({ buildApps: 10 }),
          reset: {
            apiRateLimit: null,
            triggerEvents: null,
          },
        },
      }))

      // Act
      render(<AppsFull loc="billing_dialog" />)

      // Assert
      expect(screen.getByText('billing.apps.fullTip1')).toBeInTheDocument()
      expect(screen.getByText('billing.upgradeBtn.encourageShort')).toBeInTheDocument()
      expect(screen.queryByText('billing.apps.contactUs')).not.toBeInTheDocument()
    })

    it('should render contact button for enterprise plans', () => {
      // Arrange
      ;(useProviderContext as Mock).mockReturnValue(buildProviderContext({
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.enterprise,
          usage: buildUsage({ buildApps: 9 }),
          total: buildUsage({ buildApps: 10 }),
          reset: {
            apiRateLimit: null,
            triggerEvents: null,
          },
        },
      }))

      // Act
      render(<AppsFull loc="billing_dialog" />)

      // Assert
      expect(screen.getByText('billing.apps.fullTip1')).toBeInTheDocument()
      expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'billing.apps.contactUs' })).toHaveAttribute('href', 'mailto:support@example.com')
      expect(mailToSupport).toHaveBeenCalledWith('user@example.com', Plan.enterprise, '1.0.0')
    })
  })

  // Edge cases for progress color thresholds.
  describe('Edge Cases', () => {
    it('should use the success color when usage is below 50%', () => {
      // Arrange
      ;(useProviderContext as Mock).mockReturnValue(buildProviderContext({
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.sandbox,
          usage: buildUsage({ buildApps: 2 }),
          total: buildUsage({ buildApps: 5 }),
          reset: {
            apiRateLimit: null,
            triggerEvents: null,
          },
        },
      }))

      // Act
      render(<AppsFull loc="billing_dialog" />)

      // Assert
      expect(screen.getByTestId('billing-progress-bar')).toHaveClass('bg-components-progress-bar-progress-solid')
    })

    it('should use the warning color when usage is between 50% and 80%', () => {
      // Arrange
      ;(useProviderContext as Mock).mockReturnValue(buildProviderContext({
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.sandbox,
          usage: buildUsage({ buildApps: 6 }),
          total: buildUsage({ buildApps: 10 }),
          reset: {
            apiRateLimit: null,
            triggerEvents: null,
          },
        },
      }))

      // Act
      render(<AppsFull loc="billing_dialog" />)

      // Assert
      expect(screen.getByTestId('billing-progress-bar')).toHaveClass('bg-components-progress-warning-progress')
    })

    it('should use the error color when usage is 80% or higher', () => {
      // Arrange
      ;(useProviderContext as Mock).mockReturnValue(buildProviderContext({
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.sandbox,
          usage: buildUsage({ buildApps: 8 }),
          total: buildUsage({ buildApps: 10 }),
          reset: {
            apiRateLimit: null,
            triggerEvents: null,
          },
        },
      }))

      // Act
      render(<AppsFull loc="billing_dialog" />)

      // Assert
      expect(screen.getByTestId('billing-progress-bar')).toHaveClass('bg-components-progress-error-progress')
    })
  })
})
