import type { ChatWithHistoryContextValue } from '../context'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatWithHistoryContext } from '../context'
import InputsFormNode from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...inputs: (string | boolean | undefined)[]) => inputs.filter(Boolean).join(' '),
}))

type MockButtonProps = {
  'children': React.ReactNode
  'onClick'?: () => void
  'style'?: React.CSSProperties
  'className'?: string
  'data-testid'?: string
}

vi.mock('@/app/components/base/button', () => ({
  __esModule: true,
  default: ({ children, onClick, style, className, 'data-testid': dataTestId }: MockButtonProps) => (
    <button onClick={onClick} style={style} className={className} data-testid={dataTestId || 'mock-button'}>
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/base/chat/chat-with-history/inputs-form/content', () => ({
  __esModule: true,
  default: () => <div data-testid="inputs-form-content">InputsFormContent</div>,
}))

vi.mock('@/app/components/base/divider', () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) => <div data-testid="divider" className={className} />,
}))

vi.mock('@/app/components/base/icons/src/public/other', () => ({
  Message3Fill: ({ className }: { className?: string }) => <svg data-testid="message-icon" className={className} />,
}))

vi.mock('../context', () => ({
  useChatWithHistoryContext: vi.fn(),
}))

const mockHandleStartChat = vi.fn((cb?: () => void) => {
  if (cb)
    cb()
})

const defaultContextValues: Partial<ChatWithHistoryContextValue> = {
  isMobile: false,
  currentConversationId: '',
  handleStartChat: mockHandleStartChat,
  allInputsHidden: false,
  themeBuilder: undefined,
  inputsForms: [{}],
}

const setMockContext = (overrides: Partial<ChatWithHistoryContextValue> = {}) => {
  vi.mocked(useChatWithHistoryContext).mockReturnValue({
    ...defaultContextValues,
    ...overrides,
  } as unknown as ChatWithHistoryContextValue)
}

describe('InputsFormNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // ensure a predictable default context for each test
    setMockContext()
  })

  it('should render nothing if allInputsHidden is true', () => {
    setMockContext({ allInputsHidden: true })
    const { container } = render(<InputsFormNode collapsed={true} setCollapsed={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render nothing if inputsForms array is empty', () => {
    setMockContext({ inputsForms: [] })
    const { container } = render(<InputsFormNode collapsed={true} setCollapsed={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render collapsed state with edit button and dividers', () => {
    const setCollapsed = vi.fn()
    setMockContext({ currentConversationId: '' })
    render(<InputsFormNode collapsed={true} setCollapsed={setCollapsed} />)

    expect(screen.getByText('chat.chatSettingsTitle')).toBeInTheDocument()
    expect(screen.getByTestId('message-icon')).toBeInTheDocument()

    const editBtn = screen.getByText('operation.edit')
    fireEvent.click(editBtn)
    expect(setCollapsed).toHaveBeenCalledWith(false)

    const dividers = screen.getAllByTestId('divider')
    expect(dividers.length).toBe(2)
  })

  it('should render expanded state with close button when a conversation exists', () => {
    const setCollapsed = vi.fn()
    setMockContext({ currentConversationId: 'conv-1' })
    render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)

    expect(screen.getByTestId('inputs-form-content')).toBeInTheDocument()
    const closeBtn = screen.getByText('operation.close')
    fireEvent.click(closeBtn)
    expect(setCollapsed).toHaveBeenCalledWith(true)
    expect(screen.queryByText('chat.startChat')).toBeNull()
  })

  it('should render start chat button with theme styling when no conversation exists', () => {
    const setCollapsed = vi.fn()
    const themeColor = '#123456'

    setMockContext({
      currentConversationId: '',
      themeBuilder: {
        theme: { primaryColor: themeColor },
        buildChecker: vi.fn(),
        buildTheme: vi.fn(),
      } as unknown as ChatWithHistoryContextValue['themeBuilder'],
    })

    render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)
    const startBtn = screen.getByText('chat.startChat')

    expect(startBtn).toBeInTheDocument()
    expect(startBtn).toHaveStyle({ backgroundColor: themeColor })

    fireEvent.click(startBtn)
    expect(mockHandleStartChat).toHaveBeenCalled()
    expect(setCollapsed).toHaveBeenCalledWith(true)
  })

  it('should apply mobile specific classes when isMobile is true', () => {
    setMockContext({ isMobile: true })
    const { container } = render(<InputsFormNode collapsed={false} setCollapsed={vi.fn()} />)

    // Check for mobile-specific layout classes
    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv.className).toContain('pt-4')
    expect(screen.getByTestId('inputs-form-content').parentElement?.className).toContain('p-4')
  })
})
