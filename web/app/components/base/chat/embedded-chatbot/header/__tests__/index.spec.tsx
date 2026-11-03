import type { ReactElement } from 'react'
import type { EmbeddedChatbotContextValue } from '../../context'
import type { AppData } from '@/models/share'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createEmbeddedChatbotContextFixture } from '@/test/fixtures/embedded-chatbot'
import { EmbeddedChatbotContext } from '../../context'
import Header from '../index'

let context = createEmbeddedChatbotContextFixture()
const setContext = (value: Partial<EmbeddedChatbotContextValue>) => {
  context = createEmbeddedChatbotContextFixture(value)
}
let mockBranding = { enabled: true, workspace_logo: '' }
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(
    <EmbeddedChatbotContext.Provider value={context}>{ui}</EmbeddedChatbotContext.Provider>,
    {
      systemFeatures: { branding: { ...mockBranding } },
    },
  )

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

  const setupIframe = () => {
    const mockPostMessage = vi.fn()
    const mockTop = { postMessage: mockPostMessage }
    vi.stubGlobal('self', {})
    vi.stubGlobal('top', mockTop)
    vi.stubGlobal('parent', mockTop)
    return mockPostMessage
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockBranding = { enabled: true, workspace_logo: '' }
    setContext(defaultContext)

    vi.stubGlobal('self', window)
    vi.stubGlobal('top', window)
    vi.stubGlobal('parent', window)
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('')
  })

  const dispatchChatbotConfigMessage = async (
    origin: string,
    payload: { isToggledByButton: boolean; isDraggable: boolean },
  ) => {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window.parent,
          origin,
          data: {
            type: 'dify-chatbot-config',
            payload,
          },
        }),
      )
    })
  }

  describe('Desktop Rendering', () => {
    it('should render desktop header with branding by default', async () => {
      render(<Header title="Test Chatbot" />)

      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
      expect(screen.getByAltText('Dify')).toBeInTheDocument()
    })

    it('should render custom logo when provided in appData', () => {
      setContext({
        ...defaultContext,
        appData: {
          ...defaultAppData,
          custom_config: {
            ...defaultAppData.custom_config,
            replace_webapp_logo: 'https://example.com/logo.png',
          },
        },
      })

      render(<Header title="Test Chatbot" />)

      const img = screen.getByAltText('logo')
      expect(img).toHaveAttribute('src', 'https://example.com/logo.png')
    })

    it('should render workspace logo when branding is enabled and logo exists', () => {
      mockBranding = { enabled: true, workspace_logo: 'https://example.com/workspace.png' }

      render(<Header title="Test Chatbot" />)

      const img = screen.getByAltText('logo')
      expect(img).toHaveAttribute('src', 'https://example.com/workspace.png')
    })

    it('should render Dify logo when branding is disabled', () => {
      mockBranding = { enabled: false, workspace_logo: '' }
      render(<Header title="Test Chatbot" />)
      expect(screen.getByAltText('Dify')).toBeInTheDocument()
    })

    it('should NOT render branding when remove_webapp_brand is true', () => {
      setContext({
        ...defaultContext,
        appData: {
          ...defaultAppData,
          custom_config: {
            ...defaultAppData.custom_config,
            remove_webapp_brand: true,
          },
        },
      })

      render(<Header title="Test Chatbot" />)

      expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
    })

    it('should call onCreateNewChat when reset button is clicked', async () => {
      const user = userEvent.setup()
      const onCreateNewChat = vi.fn()
      render(
        <Header title="Test Chatbot" allowResetChat={true} onCreateNewChat={onCreateNewChat} />,
      )

      await user.click(screen.getByRole('button', { name: 'share.chat.resetChat' }))
      expect(onCreateNewChat).toHaveBeenCalled()
    })

    it('opens settings with actual conversation input values', async () => {
      const user = userEvent.setup()
      setContext({
        ...defaultContext,
        inputsForms: [
          { type: InputVarType.textInput, label: 'Topic', variable: 'topic', required: false },
        ],
        currentConversationInputs: { topic: 'Travel' },
        allInputsHidden: false,
      })

      render(<Header title="Test Chatbot" />)

      expect(
        screen.getByRole('button', { name: 'share.chat.viewChatSettings' }),
      ).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'share.chat.viewChatSettings' }))
      expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('Travel')
    })

    it('should NOT render ViewFormDropdown when inputs are hidden', () => {
      setContext({
        ...defaultContext,
        inputsForms: [
          { type: InputVarType.textInput, label: 'Topic', variable: 'topic', required: false },
        ],
        currentConversationInputs: { topic: 'Travel' },
        allInputsHidden: true,
      })

      render(<Header title="Test Chatbot" />)

      expect(
        screen.queryByRole('button', { name: 'share.chat.viewChatSettings' }),
      ).not.toBeInTheDocument()
    })

    it('should NOT render ViewFormDropdown when currentConversationId is missing', () => {
      setContext({
        ...defaultContext,
        currentConversationId: '',
        inputsForms: [
          { type: InputVarType.textInput, label: 'Topic', variable: 'topic', required: false },
        ],
        currentConversationInputs: { topic: 'Travel' },
      })

      render(<Header title="Test Chatbot" />)

      expect(
        screen.queryByRole('button', { name: 'share.chat.viewChatSettings' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Mobile Rendering', () => {
    it('should NOT render mobile reset button when currentConversationId is missing', () => {
      setContext({
        ...defaultContext,
        currentConversationId: '',
      })
      render(<Header title="Mobile Chatbot" isMobile allowResetChat />)

      expect(screen.queryByRole('button', { name: 'share.chat.resetChat' })).not.toBeInTheDocument()
    })

    it('should handle mobile expand button', async () => {
      const user = userEvent.setup()
      const mockPostMessage = setupIframe()
      render(<Header title="Mobile Chatbot" isMobile />)

      await dispatchChatbotConfigMessage('https://parent.com', {
        isToggledByButton: true,
        isDraggable: false,
      })

      const expandBtn = await screen.findByRole('button', { name: 'share.chat.expand' })
      expect(expandBtn).toBeInTheDocument()

      await user.click(expandBtn)
      expect(mockPostMessage).toHaveBeenCalledWith(
        { type: 'dify-chatbot-expand-change' },
        'https://parent.com',
      )
    })
  })

  describe('Iframe Communication', () => {
    it('should send dify-chatbot-iframe-ready on mount', () => {
      const mockPostMessage = setupIframe()
      render(<Header title="Iframe" />)

      expect(mockPostMessage).toHaveBeenCalledWith({ type: 'dify-chatbot-iframe-ready' }, '*')
    })

    it('should update expand button visibility and handle click', async () => {
      const user = userEvent.setup()
      const mockPostMessage = setupIframe()
      render(<Header title="Iframe" />)

      await dispatchChatbotConfigMessage('https://parent.com', {
        isToggledByButton: true,
        isDraggable: false,
      })

      const expandBtn = await screen.findByRole('button', { name: 'share.chat.expand' })
      expect(expandBtn).toBeInTheDocument()

      await user.click(expandBtn)

      expect(mockPostMessage).toHaveBeenCalledWith(
        { type: 'dify-chatbot-expand-change' },
        'https://parent.com',
      )
      expect(screen.getByRole('button', { name: 'share.chat.collapse' })).toBeInTheDocument()
    })

    it('should NOT show expand button if isDraggable is true', async () => {
      setupIframe()
      render(<Header title="Iframe" />)

      await dispatchChatbotConfigMessage('https://parent.com', {
        isToggledByButton: true,
        isDraggable: true,
      })

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'share.chat.expand' })).not.toBeInTheDocument()
      })
    })

    it('should ignore messages from different origins after security lock', async () => {
      setupIframe()
      render(<Header title="Iframe" />)

      await dispatchChatbotConfigMessage('https://secure.com', {
        isToggledByButton: true,
        isDraggable: false,
      })

      await screen.findByRole('button', { name: 'share.chat.expand' })

      await dispatchChatbotConfigMessage('https://malicious.com', {
        isToggledByButton: false,
        isDraggable: false,
      })

      // Should still be visible (not hidden by the malicious message)
      expect(screen.getByRole('button', { name: 'share.chat.expand' })).toBeInTheDocument()
    })

    it('should ignore non-config messages for origin locking', async () => {
      setupIframe()
      render(<Header title="Iframe" />)

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'https://first.com',
            source: window.parent,
            data: { type: 'other-type' },
          }),
        )
      })

      await dispatchChatbotConfigMessage('https://second.com', {
        isToggledByButton: true,
        isDraggable: false,
      })

      // Should lock to second.com
      const expandBtn = await screen.findByRole('button', { name: 'share.chat.expand' })
      expect(expandBtn).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle document.referrer for targetOrigin', () => {
      const mockPostMessage = setupIframe()
      vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://referrer.com')
      render(<Header title="Referrer" />)

      expect(mockPostMessage).toHaveBeenCalledWith(expect.anything(), 'https://referrer.com')
    })

    it('should NOT add message listener if not in iframe', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      render(<Header title="Direct" />)
      expect(addSpy).not.toHaveBeenCalledWith('message', expect.any(Function))
    })
  })
  it.each([
    null,
    {},
    { type: 'dify-chatbot-config' },
    { type: 'dify-chatbot-config', payload: null },
  ])('ignores malformed messages without locking the parent origin: %j', async (data) => {
    setupIframe()
    render(<Header title="Iframe" />)
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', { origin: 'https://invalid.com', source: window.parent, data }),
      ),
    )
    await dispatchChatbotConfigMessage('https://parent.com', {
      isToggledByButton: true,
      isDraggable: false,
    })
    expect(screen.getByRole('button', { name: 'share.chat.expand' })).toBeInTheDocument()
  })

  it('ignores config messages from another frame before accepting the parent', async () => {
    setupIframe()
    render(<Header title="Iframe" />)
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://other.com',
          source: window,
          data: {
            type: 'dify-chatbot-config',
            payload: { isToggledByButton: true, isDraggable: false },
          },
        }),
      ),
    )
    expect(screen.queryByRole('button', { name: 'share.chat.expand' })).not.toBeInTheDocument()
    await dispatchChatbotConfigMessage('https://parent.com', {
      isToggledByButton: true,
      isDraggable: false,
    })
    expect(screen.getByRole('button', { name: 'share.chat.expand' })).toBeInTheDocument()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
})
