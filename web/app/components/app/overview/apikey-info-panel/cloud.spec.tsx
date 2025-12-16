import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import APIKeyInfoPanel from './index'

jest.mock('@/context/provider-context', () => ({
  useProviderContext: jest.fn(),
}))

jest.mock('@/context/modal-context', () => ({
  useModalContext: jest.fn(),
}))

jest.mock('@/config', () => ({
  IS_CE_EDITION: false, // Test Cloud edition
}))

import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'
import { defaultPlan } from '@/app/components/billing/config'
import { noop } from 'lodash-es'

const mockUseProviderContext = useProviderContext as jest.MockedFunction<typeof useProviderContext>
const mockUseModalContext = useModalContext as jest.MockedFunction<typeof useModalContext>

const defaultProviderContext = {
  modelProviders: [],
  refreshModelProviders: noop,
  textGenerationModelList: [],
  supportRetrievalMethods: [],
  isAPIKeySet: false,
  plan: defaultPlan,
  isFetchedPlan: false,
  enableBilling: false,
  onPlanInfoChanged: noop,
  enableReplaceWebAppLogo: false,
  modelLoadBalancingEnabled: false,
  datasetOperatorEnabled: false,
  enableEducationPlan: false,
  isEducationWorkspace: false,
  isEducationAccount: false,
  allowRefreshEducationVerify: false,
  educationAccountExpireAt: null,
  isLoadingEducationAccountInfo: false,
  isFetchingEducationAccountInfo: false,
  webappCopyrightEnabled: false,
  licenseLimit: {
    workspace_members: {
      size: 0,
      limit: 0,
    },
  },
  refreshLicenseLimit: noop,
  isAllowTransferWorkspace: false,
  isAllowPublishAsCustomKnowledgePipelineTemplate: false,
}

const defaultModalContext = {
  setShowAccountSettingModal: noop,
  setShowApiBasedExtensionModal: noop,
  setShowModerationSettingModal: noop,
  setShowExternalDataToolModal: noop,
  setShowPricingModal: noop,
  setShowAnnotationFullModal: noop,
  setShowModelModal: noop,
  setShowExternalKnowledgeAPIModal: noop,
  setShowModelLoadBalancingModal: noop,
  setShowOpeningModal: noop,
  setShowUpdatePluginModal: noop,
  setShowEducationExpireNoticeModal: noop,
  setShowTriggerEventsLimitModal: noop,
}

afterEach(cleanup)

describe('APIKeyInfoPanel - Cloud Edition', () => {
  const mockSetShowAccountSettingModal = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()

    mockUseProviderContext.mockReturnValue({
      ...defaultProviderContext,
      isAPIKeySet: false,
    })

    mockUseModalContext.mockReturnValue({
      ...defaultModalContext,
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    })
  })

  describe('Rendering', () => {
    it('should render without crashing when API key is not set', () => {
      render(<APIKeyInfoPanel />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should not render when API key is already set', () => {
      mockUseProviderContext.mockReturnValue({
        ...defaultProviderContext,
        isAPIKeySet: true,
      })

      const { container } = render(<APIKeyInfoPanel />)

      expect(container.firstChild).toBeNull()
    })

    it('should not render when panel is hidden by user', () => {
      const { container } = render(<APIKeyInfoPanel />)

      const closeButton = container.querySelector('.cursor-pointer')
      fireEvent.click(closeButton!)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Cloud Edition Content', () => {
    it('should display cloud version title', () => {
      render(<APIKeyInfoPanel />)

      expect(screen.getByText('appOverview.apiKeyInfo.cloud.trial.title')).toBeInTheDocument()
    })

    it('should display emoji for cloud version', () => {
      const { container } = render(<APIKeyInfoPanel />)

      expect(container.querySelector('em-emoji')).toBeInTheDocument()
      expect(container.querySelector('em-emoji')).toHaveAttribute('id', '😀')
    })

    it('should display cloud version description', () => {
      render(<APIKeyInfoPanel />)

      expect(screen.getByText(/appOverview\.apiKeyInfo\.cloud\.trial\.description/)).toBeInTheDocument()
    })

    it('should not render external link for cloud version', () => {
      const { container } = render(<APIKeyInfoPanel />)

      expect(container.querySelector('a[href="https://cloud.dify.ai/apps"]')).not.toBeInTheDocument()
    })

    it('should display set API button text', () => {
      render(<APIKeyInfoPanel />)

      expect(screen.getByText('appOverview.apiKeyInfo.setAPIBtn')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call setShowAccountSettingModal when set API button is clicked', () => {
      render(<APIKeyInfoPanel />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: ACCOUNT_SETTING_TAB.PROVIDER,
      })
    })

    it('should hide panel when close button is clicked', () => {
      const { container } = render(<APIKeyInfoPanel />)
      expect(container.firstChild).toBeInTheDocument()

      const closeButton = container.querySelector('.cursor-pointer')
      fireEvent.click(closeButton!)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Props and Styling', () => {
    it('should render button with primary variant', () => {
      render(<APIKeyInfoPanel />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-primary')
    })

    it('should render panel container with correct classes', () => {
      const { container } = render(<APIKeyInfoPanel />)

      const panel = container.firstChild as HTMLElement
      expect(panel).toHaveClass(
        'border-components-panel-border',
        'bg-components-panel-bg',
        'relative',
        'mb-6',
        'rounded-2xl',
        'border',
        'p-8',
        'shadow-md',
      )
    })
  })

  describe('Accessibility', () => {
    it('should have button with proper role', () => {
      render(<APIKeyInfoPanel />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should have clickable close button', () => {
      const { container } = render(<APIKeyInfoPanel />)
      const closeButton = container.querySelector('.cursor-pointer')
      expect(closeButton).toHaveClass('cursor-pointer')
    })
  })
})
