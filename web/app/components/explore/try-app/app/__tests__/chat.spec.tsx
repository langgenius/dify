import type { TrialAppDetailResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
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

vi.mock('@/app/components/base/chat/embedded-chatbot/chat-wrapper', () => ({
  default: () => <div data-testid="chat-wrapper">ChatWrapper</div>,
}))

vi.mock('@/app/components/base/chat/embedded-chatbot/inputs-form/view-form-dropdown', () => ({
  default: () => <div data-testid="view-form-dropdown">ViewFormDropdown</div>,
}))

const createMockAppDetail = (
  overrides: Partial<TrialAppDetailResponse> = {},
): TrialAppDetailResponse =>
  ({
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
  }) as unknown as TrialAppDetailResponse

describe('TryApp (chat.tsx)', () => {
  beforeEach(() => {
    mockUseEmbeddedChatbot.mockReturnValue({
      removeConversationIdInfo: mockRemoveConversationIdInfo,
      handleNewConversation: mockHandleNewConversation,
      currentConversationId: null,
      inputsForms: [],
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

      render(<TryApp appId="test-app-id" appDetail={appDetail} className="test-class" />)

      expect(screen.queryByRole('button', { name: 'share.chat.resetChat' })).not.toBeInTheDocument()
    })

    it('clears the saved conversation and starts a new one when reset is clicked', async () => {
      const user = userEvent.setup()
      mockUseEmbeddedChatbot.mockReturnValue({
        removeConversationIdInfo: mockRemoveConversationIdInfo,
        handleNewConversation: mockHandleNewConversation,
        currentConversationId: 'conv-123',
        inputsForms: [],
      })

      const appDetail = createMockAppDetail()

      render(<TryApp appId="test-app-id" appDetail={appDetail} className="test-class" />)

      mockRemoveConversationIdInfo.mockClear()
      await user.click(screen.getByRole('button', { name: 'share.chat.resetChat' }))

      expect(mockRemoveConversationIdInfo).toHaveBeenCalledOnce()
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

      render(<TryApp appId="test-app-id" appDetail={appDetail} className="test-class" />)

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

      render(<TryApp appId="test-app-id" appDetail={appDetail} className="test-class" />)

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

      render(<TryApp appId="test-app-id" appDetail={appDetail} className="test-class" />)

      expect(screen.getByTestId('view-form-dropdown')).toBeInTheDocument()
    })
  })

  it('dismisses the trial notice', async () => {
    const user = userEvent.setup()
    render(<TryApp appId="test-app-id" appDetail={createMockAppDetail()} className="" />)
    expect(screen.getByText('explore.tryApp.tryInfo')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(screen.queryByText('explore.tryApp.tryInfo')).not.toBeInTheDocument()
  })

  describe('hook calls', () => {
    it('calls useEmbeddedChatbot with correct parameters', () => {
      const appDetail = createMockAppDetail()

      render(<TryApp appId="my-app-id" appDetail={appDetail} className="test-class" />)

      expect(mockUseEmbeddedChatbot).toHaveBeenCalledWith('tryApp', 'my-app-id')
    })

    it('calls removeConversationIdInfo on mount', () => {
      const appDetail = createMockAppDetail()

      render(<TryApp appId="my-app-id" appDetail={appDetail} className="test-class" />)

      expect(mockRemoveConversationIdInfo).toHaveBeenCalledWith()
    })
  })
})
