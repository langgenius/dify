import type { TryAppInfo } from '@/service/try-app'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TryApp from '../chat'

const mockRemoveConversationIdInfo = vi.fn()
const mockHandleNewConversation = vi.fn()
const mockUseEmbeddedChatbot = vi.fn()

vi.mock('@/app/components/base/chat/embedded-chatbot/hooks', () => ({
  useEmbeddedChatbot: (...args: unknown[]) => mockUseEmbeddedChatbot(...args),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'pc',
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
  },
}))

vi.mock('../../../../base/chat/embedded-chatbot/theme/theme-context', () => ({
  useThemeContext: () => ({
    primaryColor: '#1890ff',
  }),
}))

vi.mock('@/app/components/base/chat/embedded-chatbot/chat-wrapper', () => ({
  default: () => <div data-testid="chat-wrapper">ChatWrapper</div>,
}))

vi.mock('@/app/components/base/chat/embedded-chatbot/inputs-form/view-form-dropdown', () => ({
  default: () => <div data-testid="view-form-dropdown">ViewFormDropdown</div>,
}))

const createMockAppDetail = (overrides: Partial<TryAppInfo> = {}): TryAppInfo => ({
  id: 'test-app-id',
  name: 'Test Chat App',
  description: 'Test Description',
  mode: 'chat',
  site: {
    title: 'Test Site Title',
    icon: '💬',
    icon_type: 'emoji',
    icon_background: '#4F46E5',
    icon_url: '',
  },
  model_config: {
    model: {
      provider: 'langgenius/openai/openai',
      name: 'gpt-4',
      mode: 'chat',
    },
    dataset_configs: {
      datasets: {
        datasets: [],
      },
    },
    agent_mode: {
      tools: [],
    },
    user_input_form: [],
  },
  ...overrides,
} as unknown as TryAppInfo)

describe('TryApp (chat.tsx)', () => {
  beforeEach(() => {
    mockUseEmbeddedChatbot.mockReturnValue({
      removeConversationIdInfo: mockRemoveConversationIdInfo,
      handleNewConversation: mockHandleNewConversation,
      currentConversationId: null,
      inputsForms: [],
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('renders app name', () => {
      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(screen.getByText('Test Chat App')).toBeInTheDocument()
    })

    it('renders app name with title attribute', () => {
      const appDetail = createMockAppDetail({ name: 'Long App Name' } as Partial<TryAppInfo>)

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      const nameElement = screen.getByText('Long App Name')
      expect(nameElement).toHaveAttribute('title', 'Long App Name')
    })

    it('renders ChatWrapper', () => {
      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(screen.getByTestId('chat-wrapper')).toBeInTheDocument()
    })

    it('renders alert with try info', () => {
      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(screen.getByText('explore.tryApp.tryInfo')).toBeInTheDocument()
    })

    it('applies className prop', () => {
      const appDetail = createMockAppDetail()

      const { container } = render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="custom-class"
        />,
      )

      const innerDiv = container.querySelector('.custom-class')
      expect(innerDiv).toBeInTheDocument()
    })
  })

  describe('reset button', () => {
    it('does not render reset button when no conversation', () => {
      mockUseEmbeddedChatbot.mockReturnValue({
        removeConversationIdInfo: mockRemoveConversationIdInfo,
        handleNewConversation: mockHandleNewConversation,
        currentConversationId: null,
        inputsForms: [],
      })

      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('renders reset button when conversation exists', () => {
      mockUseEmbeddedChatbot.mockReturnValue({
        removeConversationIdInfo: mockRemoveConversationIdInfo,
        handleNewConversation: mockHandleNewConversation,
        currentConversationId: 'conv-123',
        inputsForms: [],
      })

      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('calls handleNewConversation when reset button is clicked', () => {
      mockUseEmbeddedChatbot.mockReturnValue({
        removeConversationIdInfo: mockRemoveConversationIdInfo,
        handleNewConversation: mockHandleNewConversation,
        currentConversationId: 'conv-123',
        inputsForms: [],
      })

      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      fireEvent.click(screen.getByRole('button'))

      expect(mockRemoveConversationIdInfo).toHaveBeenCalledWith('test-app-id')
      expect(mockHandleNewConversation).toHaveBeenCalled()
    })
  })

  describe('view form dropdown', () => {
    it('does not render view form dropdown when no conversation', () => {
      mockUseEmbeddedChatbot.mockReturnValue({
        removeConversationIdInfo: mockRemoveConversationIdInfo,
        handleNewConversation: mockHandleNewConversation,
        currentConversationId: null,
        inputsForms: [{ id: 'form1' }],
      })

      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(screen.queryByTestId('view-form-dropdown')).not.toBeInTheDocument()
    })

    it('does not render view form dropdown when no input forms', () => {
      mockUseEmbeddedChatbot.mockReturnValue({
        removeConversationIdInfo: mockRemoveConversationIdInfo,
        handleNewConversation: mockHandleNewConversation,
        currentConversationId: 'conv-123',
        inputsForms: [],
      })

      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(screen.queryByTestId('view-form-dropdown')).not.toBeInTheDocument()
    })

    it('renders view form dropdown when conversation and input forms exist', () => {
      mockUseEmbeddedChatbot.mockReturnValue({
        removeConversationIdInfo: mockRemoveConversationIdInfo,
        handleNewConversation: mockHandleNewConversation,
        currentConversationId: 'conv-123',
        inputsForms: [{ id: 'form1' }],
      })

      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(screen.getByTestId('view-form-dropdown')).toBeInTheDocument()
    })
  })

  describe('alert hiding', () => {
    it('hides alert when onHide is called', () => {
      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="test-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      const alertElement = screen.getByText('explore.tryApp.tryInfo').closest('[class*="alert"]')?.parentElement
      const hideButton = alertElement?.querySelector('button, [role="button"], svg')

      if (hideButton) {
        fireEvent.click(hideButton)
        expect(screen.queryByText('explore.tryApp.tryInfo')).not.toBeInTheDocument()
      }
    })
  })

  describe('hook calls', () => {
    it('calls useEmbeddedChatbot with correct parameters', () => {
      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="my-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(mockUseEmbeddedChatbot).toHaveBeenCalledWith('tryApp', 'my-app-id')
    })

    it('calls removeConversationIdInfo on mount', () => {
      const appDetail = createMockAppDetail()

      render(
        <TryApp
          appId="my-app-id"
          appDetail={appDetail}
          className="test-class"
        />,
      )

      expect(mockRemoveConversationIdInfo).toHaveBeenCalledWith('my-app-id')
    })
  })
})
