import type { ChatWithHistoryContextValue } from '../context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputVarType } from '@/app/components/workflow/types'
import { useChatWithHistoryContext } from '../context'
import InputsFormNode from './index'

// Mocks for components used by InputsFormContent (the real sibling)
vi.mock('@/app/components/workflow/nodes/_base/components/before-run-form/bool-input', () => ({
  default: ({ value, name }: { value: boolean, name: string }) => (
    <div data-testid="mock-bool-input" role="checkbox" aria-checked={value}>
      {name}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value, placeholder }: { value: string, placeholder?: React.ReactNode }) => (
    <div data-testid="mock-code-editor">
      <span>{value}</span>
      {placeholder}
    </div>
  ),
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({ value }: { value?: unknown[] }) => (
    <div data-testid="mock-file-uploader" data-count={value?.length ?? 0} />
  ),
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
  inputsForms: [{ variable: 'test_var', type: InputVarType.textInput, label: 'Test Label' }],
  currentConversationInputs: {},
  newConversationInputs: {},
  newConversationInputsRef: { current: {} } as unknown as React.RefObject<Record<string, unknown>>,
  setCurrentConversationInputs: vi.fn(),
  handleNewConversationInputsChange: vi.fn(),
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

  it('should render collapsed state with edit button', async () => {
    const user = userEvent.setup()
    const setCollapsed = vi.fn()
    setMockContext({ currentConversationId: '' })
    render(<InputsFormNode collapsed={true} setCollapsed={setCollapsed} />)

    expect(screen.getByText('share.chat.chatSettingsTitle')).toBeInTheDocument()

    const editBtn = screen.getByRole('button', { name: /common.operation.edit/i })
    await user.click(editBtn)
    expect(setCollapsed).toHaveBeenCalledWith(false)
  })

  it('should render expanded state with close button when a conversation exists', async () => {
    const user = userEvent.setup()
    const setCollapsed = vi.fn()
    setMockContext({ currentConversationId: 'conv-1' })
    render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)

    // Real InputsFormContent should render the label
    expect(screen.getByText('Test Label')).toBeInTheDocument()

    const closeBtn = screen.getByRole('button', { name: /common.operation.close/i })
    await user.click(closeBtn)
    expect(setCollapsed).toHaveBeenCalledWith(true)
  })

  it('should render start chat button with theme styling when no conversation exists', async () => {
    const user = userEvent.setup()
    const setCollapsed = vi.fn()
    const themeColor = 'rgb(18, 52, 86)' // #123456

    setMockContext({
      currentConversationId: '',
      themeBuilder: {
        theme: { primaryColor: themeColor },
      } as unknown as ChatWithHistoryContextValue['themeBuilder'],
    })

    render(<InputsFormNode collapsed={false} setCollapsed={setCollapsed} />)
    const startBtn = screen.getByRole('button', { name: /share.chat.startChat/i })

    expect(startBtn).toBeInTheDocument()
    expect(startBtn).toHaveStyle({ backgroundColor: themeColor })

    await user.click(startBtn)
    expect(mockHandleStartChat).toHaveBeenCalled()
    expect(setCollapsed).toHaveBeenCalledWith(true)
  })

  it('should apply mobile specific classes when isMobile is true', () => {
    setMockContext({ isMobile: true })
    const { container } = render(<InputsFormNode collapsed={false} setCollapsed={vi.fn()} />)

    // Prefer selecting by a test id if the component exposes it. Fallback to queries that
    // don't rely on internal DOM structure so tests are less brittle.
    const outerDiv = screen.queryByTestId('inputs-form-node') ?? (container.firstChild as HTMLElement)
    expect(outerDiv).toBeTruthy()
    // Check for mobile-specific layout classes (pt-4)
    expect(outerDiv).toHaveClass('pt-4')

    // Check padding in expanded content (p-4 for mobile)
    // Prefer a test id for the content wrapper; fallback to finding the label's closest ancestor
    const contentWrapper = screen.queryByTestId('inputs-form-content-wrapper') ?? screen.getByText('Test Label').closest('.p-4')
    expect(contentWrapper).toBeInTheDocument()
  })
})
