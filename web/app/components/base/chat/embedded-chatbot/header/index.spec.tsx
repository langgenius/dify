/* eslint-disable next/no-img-element */
import type { ImgHTMLAttributes } from 'react'
import type { EmbeddedChatbotContextValue } from '../context'
import type { AppData } from '@/models/share'
import type { SystemFeatures } from '@/types/feature'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { InstallationScope, LicenseStatus } from '@/types/feature'
import { useEmbeddedChatbotContext } from '../context'
import Header from './index'

vi.mock('../context', () => ({
  useEmbeddedChatbotContext: vi.fn(),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/app/components/base/chat/embedded-chatbot/inputs-form/view-form-dropdown', () => ({
  default: () => <div data-testid="view-form-dropdown" />,
}))

// Mock next/image to render a normal img tag for testing
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
    const { unoptimized: _, ...rest } = props
    return <img {...rest} />
  },
}))

type GlobalPublicStoreMock = {
  systemFeatures: SystemFeatures
  setSystemFeatures: (systemFeatures: SystemFeatures) => void
}

describe('EmbeddedChatbot Header', () => {
  const defaultAppData: AppData = {
    app_id: 'test-app-id',
    can_replace_logo: true,
    custom_config: {
      remove_webapp_brand: false,
      replace_webapp_logo: '',
    },
    enable_site: true,
    end_user_id: 'test-user-id',
    site: {
      title: 'Test Site',
    },
  }

  const defaultContext: Partial<EmbeddedChatbotContextValue> = {
    appData: defaultAppData,
    currentConversationId: 'test-conv-id',
    inputsForms: [],
    allInputsHidden: false,
  }

  const defaultSystemFeatures: SystemFeatures = {
    trial_models: [],
    plugin_installation_permission: {
      plugin_installation_scope: InstallationScope.ALL,
      restrict_to_marketplace_only: false,
    },
    sso_enforced_for_signin: false,
    sso_enforced_for_signin_protocol: '',
    sso_enforced_for_web: false,
    sso_enforced_for_web_protocol: '',
    enable_marketplace: false,
    enable_change_email: false,
    enable_email_code_login: false,
    enable_email_password_login: false,
    enable_social_oauth_login: false,
    is_allow_create_workspace: false,
    is_allow_register: false,
    is_email_setup: false,
    license: {
      status: LicenseStatus.NONE,
      expired_at: '',
    },
    branding: {
      enabled: true,
      workspace_logo: '',
      login_page_logo: '',
      favicon: '',
      application_title: '',
    },
    webapp_auth: {
      enabled: false,
      allow_sso: false,
      sso_config: { protocol: '' },
      allow_email_code_login: false,
      allow_email_password_login: false,
    },
    enable_trial_app: false,
    enable_explore_banner: false,
  }

  const setupIframe = () => {
    const mockPostMessage = vi.fn()
    const mockTop = { postMessage: mockPostMessage }
    Object.defineProperty(window, 'self', { value: {}, configurable: true })
    Object.defineProperty(window, 'top', { value: mockTop, configurable: true })
    Object.defineProperty(window, 'parent', { value: mockTop, configurable: true })
    return mockPostMessage
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useEmbeddedChatbotContext).mockReturnValue(defaultContext as EmbeddedChatbotContextValue)
    vi.mocked(useGlobalPublicStore).mockImplementation((selector: (s: GlobalPublicStoreMock) => unknown) => selector({
      systemFeatures: defaultSystemFeatures,
      setSystemFeatures: vi.fn(),
    }))

    Object.defineProperty(window, 'self', { value: window, configurable: true })
    Object.defineProperty(window, 'top', { value: window, configurable: true })
  })

  describe('Desktop Rendering', () => {
    it('should render desktop header with branding by default', async () => {
      render(<Header title="Test Chatbot" />)

      expect(screen.getByTestId('webapp-brand')).toBeInTheDocument()
      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    })

    it('should render custom logo when provided in appData', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
        ...defaultContext,
        appData: {
          ...defaultAppData,
          custom_config: {
            ...defaultAppData.custom_config,
            replace_webapp_logo: 'https://example.com/logo.png',
          },
        },
      } as EmbeddedChatbotContextValue)

      render(<Header title="Test Chatbot" />)

      const img = screen.getByAltText('logo')
      expect(img).toHaveAttribute('src', 'https://example.com/logo.png')
    })

    it('should render workspace logo when branding is enabled and logo exists', () => {
      vi.mocked(useGlobalPublicStore).mockImplementation((selector: (s: GlobalPublicStoreMock) => unknown) => selector({
        systemFeatures: {
          ...defaultSystemFeatures,
          branding: {
            ...defaultSystemFeatures.branding,
            workspace_logo: 'https://example.com/workspace.png',
          },
        },
        setSystemFeatures: vi.fn(),
      }))

      render(<Header title="Test Chatbot" />)

      const img = screen.getByAltText('logo')
      expect(img).toHaveAttribute('src', 'https://example.com/workspace.png')
    })

    it('should render Dify logo by default when no branding or custom logo is provided', () => {
      vi.mocked(useGlobalPublicStore).mockImplementation((selector: (s: GlobalPublicStoreMock) => unknown) => selector({
        systemFeatures: {
          ...defaultSystemFeatures,
          branding: {
            ...defaultSystemFeatures.branding,
            enabled: false,
          },
        },
        setSystemFeatures: vi.fn(),
      }))
      render(<Header title="Test Chatbot" />)
      expect(screen.getByAltText('Dify logo')).toBeInTheDocument()
    })

    it('should NOT render branding when remove_webapp_brand is true', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
        ...defaultContext,
        appData: {
          ...defaultAppData,
          custom_config: {
            ...defaultAppData.custom_config,
            remove_webapp_brand: true,
          },
        },
      } as EmbeddedChatbotContextValue)

      render(<Header title="Test Chatbot" />)

      expect(screen.queryByTestId('webapp-brand')).not.toBeInTheDocument()
    })

    it('should render reset button when allowResetChat is true and conversation exists', () => {
      render(<Header title="Test Chatbot" allowResetChat={true} />)

      expect(screen.getByTestId('reset-chat-button')).toBeInTheDocument()
    })

    it('should call onCreateNewChat when reset button is clicked', async () => {
      const user = userEvent.setup()
      const onCreateNewChat = vi.fn()
      render(<Header title="Test Chatbot" allowResetChat={true} onCreateNewChat={onCreateNewChat} />)

      await user.click(screen.getByTestId('reset-chat-button'))
      expect(onCreateNewChat).toHaveBeenCalled()
    })

    it('should render ViewFormDropdown when conditions are met', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
        ...defaultContext,
        inputsForms: [{ id: '1' }],
        allInputsHidden: false,
      } as EmbeddedChatbotContextValue)

      render(<Header title="Test Chatbot" />)

      expect(screen.getByTestId('view-form-dropdown')).toBeInTheDocument()
    })

    it('should NOT render ViewFormDropdown when inputs are hidden', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
        ...defaultContext,
        inputsForms: [{ id: '1' }],
        allInputsHidden: true,
      } as EmbeddedChatbotContextValue)

      render(<Header title="Test Chatbot" />)

      expect(screen.queryByTestId('view-form-dropdown')).not.toBeInTheDocument()
    })

    it('should NOT render ViewFormDropdown when currentConversationId is missing', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
        ...defaultContext,
        currentConversationId: '',
        inputsForms: [{ id: '1' }],
      } as EmbeddedChatbotContextValue)

      render(<Header title="Test Chatbot" />)

      expect(screen.queryByTestId('view-form-dropdown')).not.toBeInTheDocument()
    })
  })

  describe('Mobile Rendering', () => {
    it('should render mobile header with title', () => {
      render(<Header title="Mobile Chatbot" isMobile />)

      expect(screen.getByText('Mobile Chatbot')).toBeInTheDocument()
    })

    it('should render customer icon in mobile header', () => {
      render(<Header title="Mobile Chatbot" isMobile customerIcon={<div data-testid="custom-icon" />} />)

      expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    })

    it('should render mobile reset button when allowed', () => {
      render(<Header title="Mobile Chatbot" isMobile allowResetChat />)

      expect(screen.getByTestId('mobile-reset-chat-button')).toBeInTheDocument()
    })
  })

  describe('Iframe Communication', () => {
    it('should send dify-chatbot-iframe-ready on mount', () => {
      const mockPostMessage = setupIframe()
      render(<Header title="Iframe" />)

      expect(mockPostMessage).toHaveBeenCalledWith(
        { type: 'dify-chatbot-iframe-ready' },
        '*',
      )
    })

    it('should update expand button visibility and handle click', async () => {
      const user = userEvent.setup()
      const mockPostMessage = setupIframe()
      render(<Header title="Iframe" />)

      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://parent.com',
        data: {
          type: 'dify-chatbot-config',
          payload: { isToggledByButton: true, isDraggable: false },
        },
      }))

      const expandBtn = await screen.findByTestId('expand-button')
      expect(expandBtn).toBeInTheDocument()

      await user.click(expandBtn)

      expect(mockPostMessage).toHaveBeenCalledWith(
        { type: 'dify-chatbot-expand-change' },
        'https://parent.com',
      )
      expect(expandBtn.querySelector('.i-ri-collapse-diagonal-2-line')).toBeInTheDocument()
    })

    it('should NOT show expand button if isDraggable is true', async () => {
      setupIframe()
      render(<Header title="Iframe" />)

      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://parent.com',
        data: {
          type: 'dify-chatbot-config',
          payload: { isToggledByButton: true, isDraggable: true },
        },
      }))

      await waitFor(() => {
        expect(screen.queryByTestId('expand-button')).not.toBeInTheDocument()
      })
    })

    it('should ignore messages from different origins after security lock', async () => {
      setupIframe()
      render(<Header title="Iframe" />)

      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://secure.com',
        data: { type: 'dify-chatbot-config', payload: { isToggledByButton: true, isDraggable: false } },
      }))

      await screen.findByTestId('expand-button')

      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://malicious.com',
        data: { type: 'dify-chatbot-config', payload: { isToggledByButton: false, isDraggable: false } },
      }))

      expect(screen.getByTestId('expand-button')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle document.referrer for targetOrigin', () => {
      const mockPostMessage = setupIframe()
      Object.defineProperty(document, 'referrer', { value: 'https://referrer.com', configurable: true })
      render(<Header title="Referrer" />)

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.anything(),
        'https://referrer.com',
      )
    })

    it('should NOT add message listener if not in iframe', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      render(<Header title="Direct" />)
      expect(addSpy).not.toHaveBeenCalledWith('message', expect.any(Function))
    })
  })
})
