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

// Mock config for CE edition
vi.mock('@/config', () => ({
  IS_CE_EDITION: true, // Test CE edition by default
}))

afterEach(cleanup)

describe('APIKeyInfoPanel - Community Edition', () => {
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

  describe('Content Display', () => {
    it('should display self-host title content', () => {
      scenarios.withAPIKeyNotSet()

      expect(screen.getByText(textKeys.selfHost.titleRow1)).toBeInTheDocument()
      expect(screen.getByText(textKeys.selfHost.titleRow2)).toBeInTheDocument()
    })

    it('should display set API button text', () => {
      scenarios.withAPIKeyNotSet()
      expect(screen.getByText(textKeys.selfHost.setAPIBtn)).toBeInTheDocument()
    })

    it('should render external link with correct href for self-host version', () => {
      const { container } = scenarios.withAPIKeyNotSet()
      const link = container.querySelector('a[href="https://cloud.dify.ai/apps"]')

      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveTextContent(textKeys.selfHost.tryCloud)
    })

    it('should have external link with proper styling for self-host version', () => {
      const { container } = scenarios.withAPIKeyNotSet()
      const link = container.querySelector('a[href="https://cloud.dify.ai/apps"]')

      expect(link).toHaveClass(
        'mt-2',
        'flex',
        'h-[26px]',
        'items-center',
        'space-x-1',
        'p-1',
        'text-xs',
        'font-medium',
        'text-[#155EEF]',
      )
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

  describe('State Management', () => {
    it('should start with visible panel (isShow: true)', () => {
      scenarios.withAPIKeyNotSet()
      assertions.shouldRenderMainButton()
    })

    it('should toggle visibility when close button is clicked', () => {
      const { container } = scenarios.withAPIKeyNotSet()
      expect(container.firstChild).toBeInTheDocument()

      interactions.clickCloseButton(container)
      assertions.shouldNotRender(container)
    })
  })

  describe('Edge Cases', () => {
    it('should handle provider context loading state', () => {
      scenarios.withAPIKeyNotSet({
        providerContext: {
          modelProviders: [],
          textGenerationModelList: [],
        },
      })
      assertions.shouldRenderMainButton()
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
