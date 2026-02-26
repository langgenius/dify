/* eslint-disable ts/no-explicit-any */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSourceType } from '@/service/share'
import { useEmbeddedChatbotContext } from '../context'
import InputsFormNode from './index'

vi.mock('../context', () => ({
  useEmbeddedChatbotContext: vi.fn(),
}))

// Mock InputsFormContent to avoid complex integration in this test
vi.mock('./content', () => ({
  default: () => <div data-testid="mock-inputs-form-content" />,
}))

const mockContextValue = {
  appSourceType: AppSourceType.webApp,
  isMobile: false,
  currentConversationId: null,
  themeBuilder: null,
  handleStartChat: vi.fn(),
  allInputsHidden: false,
  inputsForms: [{ variable: 'test' }],
}

describe('InputsFormNode', () => {
  const user = userEvent.setup()
  const setCollapsed = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useEmbeddedChatbotContext).mockReturnValue(mockContextValue as unknown as any)
  })

  it('should return null if allInputsHidden is true', () => {
    vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
      ...mockContextValue,
      allInputsHidden: true,
    } as unknown as any)
    const { container } = render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)
    expect(container.firstChild).toBeNull()
  })

  it('should return null if inputsForms is empty', () => {
    vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
      ...mockContextValue,
      inputsForms: [],
    } as unknown as any)
    const { container } = render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render expanded state correctly', () => {
    render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)
    expect(screen.getByText(/chat.chatSettingsTitle/i)).toBeInTheDocument()
    expect(screen.getByTestId('mock-inputs-form-content')).toBeInTheDocument()
    expect(screen.getByTestId('inputs-form-start-chat-button')).toBeInTheDocument()
  })

  it('should render collapsed state correctly', () => {
    render(<InputsFormNode collapsed={true} setCollapsed={setCollapsed} />)
    expect(screen.getByText(/chat.chatSettingsTitle/i)).toBeInTheDocument()
    expect(screen.queryByTestId('mock-inputs-form-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('inputs-form-edit-button')).toBeInTheDocument()
  })

  it('should handle edit button click', async () => {
    render(<InputsFormNode collapsed={true} setCollapsed={setCollapsed} />)
    await user.click(screen.getByTestId('inputs-form-edit-button'))
    expect(setCollapsed).toHaveBeenCalledWith(false)
  })

  it('should handle close button click', async () => {
    vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
      ...mockContextValue,
      currentConversationId: 'conv-123',
    } as unknown as any)
    render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)
    await user.click(screen.getByTestId('inputs-form-close-button'))
    expect(setCollapsed).toHaveBeenCalledWith(true)
  })

  it('should handle start chat button click', async () => {
    const handleStartChat = vi.fn(cb => cb())

    vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
      ...mockContextValue,
      handleStartChat,
    } as unknown as any)
    render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)
    await user.click(screen.getByTestId('inputs-form-start-chat-button'))
    expect(handleStartChat).toHaveBeenCalled()
    expect(setCollapsed).toHaveBeenCalledWith(true)
  })

  it('should apply theme primary color to start chat button', () => {
    vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
      ...mockContextValue,
      themeBuilder: {
        theme: {
          primaryColor: '#ff0000',
        },
      },
    } as unknown as any)
    render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)
    const button = screen.getByTestId('inputs-form-start-chat-button')
    expect(button).toHaveStyle({ backgroundColor: '#ff0000' })
  })

  it('should apply tryApp styles when appSourceType is tryApp', () => {
    vi.mocked(useEmbeddedChatbotContext).mockReturnValue({
      ...mockContextValue,
      appSourceType: AppSourceType.tryApp,
    } as unknown as any)
    render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)
    const mainDiv = screen.getByTestId('inputs-form-node')
    expect(mainDiv).toHaveClass('mb-0 px-0')
  })
})
