import { cleanup, screen } from '@testing-library/react'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import {
  assertions,
  clearAllMocks,
  defaultModalContext,
  interactions,
  mockUseModalContext,
  scenarios,
  textKeys,
} from './apikey-info-panel.test-utils'

// Mock config for Cloud edition
vi.mock('@/config', () => ({
  IS_CE_EDITION: false, // Test Cloud edition
}))

afterEach(cleanup)

describe('APIKeyInfoPanel - Cloud Edition', () => {
  const mockSetShowAccountSettingModal = vi.fn()

  beforeEach(() => {
    clearAllMocks()
    mockUseModalContext.mockReturnValue({
      ...defaultModalContext,
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    })
  })

  describe('Rendering', () => {
    it('should render without crashing when API key is not set', () => {
      scenarios.withAPIKeyNotSet()
      assertions.shouldRenderMainButton()
    })

    it('should not render when API key is already set', () => {
      const { container } = scenarios.withAPIKeySet()
      assertions.shouldNotRender(container)
    })

    it('should not render when panel is hidden by user', () => {
      const { container } = scenarios.withAPIKeyNotSet()
      interactions.clickCloseButton(container)
      assertions.shouldNotRender(container)
    })
  })

  describe('Cloud Edition Content', () => {
    it('should display cloud version title', () => {
      scenarios.withAPIKeyNotSet()
      expect(screen.getByText(textKeys.cloud.trialTitle)).toBeInTheDocument()
    })

    it('should display emoji for cloud version', () => {
      const { container } = scenarios.withAPIKeyNotSet()
      expect(container.querySelector('em-emoji')).toBeInTheDocument()
      expect(container.querySelector('em-emoji')).toHaveAttribute('id', '😀')
    })

    it('should display cloud version description', () => {
      scenarios.withAPIKeyNotSet()
      expect(screen.getByText(textKeys.cloud.trialDescription)).toBeInTheDocument()
    })

    it('should not render external link for cloud version', () => {
      const { container } = scenarios.withAPIKeyNotSet()
      expect(container.querySelector('a[href="https://cloud.dify.ai/apps"]')).not.toBeInTheDocument()
    })

    it('should display set API button text', () => {
      scenarios.withAPIKeyNotSet()
      expect(screen.getByText(textKeys.cloud.setAPIBtn)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call setShowAccountSettingModal when set API button is clicked', () => {
      scenarios.withMockModal(mockSetShowAccountSettingModal)

      interactions.clickMainButton()

      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: ACCOUNT_SETTING_TAB.PROVIDER,
      })
    })

    it('should hide panel when close button is clicked', () => {
      const { container } = scenarios.withAPIKeyNotSet()
      expect(container.firstChild).toBeInTheDocument()

      interactions.clickCloseButton(container)
      assertions.shouldNotRender(container)
    })
  })

  describe('Props and Styling', () => {
    it('should render button with primary variant', () => {
      scenarios.withAPIKeyNotSet()
      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-primary')
    })

    it('should render panel container with correct classes', () => {
      const { container } = scenarios.withAPIKeyNotSet()
      const panel = container.firstChild as HTMLElement
      assertions.shouldHavePanelStyling(panel)
    })
  })

  describe('Accessibility', () => {
    it('should have button with proper role', () => {
      scenarios.withAPIKeyNotSet()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should have clickable close button', () => {
      const { container } = scenarios.withAPIKeyNotSet()
      assertions.shouldHaveCloseButton(container)
    })
  })
})
