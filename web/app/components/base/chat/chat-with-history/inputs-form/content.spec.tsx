import type { ChatWithHistoryContextValue } from '../context'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputVarType } from '@/app/components/workflow/types'
import { useChatWithHistoryContext } from '../context'
import InputsFormContent from './content'

// Mock FloatingPortal to render children in the normal DOM flow
vi.mock('@floating-ui/react', async () => {
  const actual = await vi.importActual('@floating-ui/react')
  return {
    ...actual,
    FloatingPortal: ({ children }: { children: React.ReactNode }) => <div data-floating-ui-portal>{children}</div>,
  }
})

// Keep lightweight mocks for non-base project components
vi.mock('@/app/components/workflow/nodes/_base/components/before-run-form/bool-input', () => ({
  default: ({ value, onChange, name }: { value: boolean, onChange: (v: boolean) => void, name: string }) => (
    <div data-testid="mock-bool-input" role="checkbox" aria-checked={value} onClick={() => onChange(!value)}>
      {name}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ onChange, value, placeholder }: { onChange: (v: string) => void, value: string, placeholder?: React.ReactNode }) => (
    <div>
      <textarea data-testid="mock-code-editor" value={value} onChange={e => onChange(e.target.value)} />
      {!!placeholder && (
        <div data-testid="mock-code-editor-placeholder">
          {React.isValidElement<{ children?: React.ReactNode }>(placeholder) ? placeholder.props.children : ''}
        </div>
      )}
    </div>
  ),
}))

// MOCK: file-uploader (stable, deterministic for unit tests)
vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({ onChange, value }: { onChange: (files: unknown[]) => void, value?: unknown[] }) => (
    <div
      data-testid="mock-file-uploader"
      onClick={() => onChange(['uploaded-file-1', 'uploaded-file-2'])}
      data-value-count={value?.length ?? 0}
    />
  ),
}))

vi.mock('../context', () => ({
  useChatWithHistoryContext: vi.fn(),
}))

const mockSetCurrentConversationInputs = vi.fn()
const mockHandleNewConversationInputsChange = vi.fn()

const defaultSystemParameters = {
  audio_file_size_limit: 1,
  file_size_limit: 1,
  image_file_size_limit: 1,
  video_file_size_limit: 1,
  workflow_file_upload_limit: 1,
}

const createMockContext = (overrides: Partial<ChatWithHistoryContextValue> = {}): ChatWithHistoryContextValue => {
  const base: ChatWithHistoryContextValue = {
    appParams: { system_parameters: defaultSystemParameters } as unknown as ChatWithHistoryContextValue['appParams'],
    inputsForms: [{ variable: 'text_var', type: InputVarType.textInput, label: 'Text Label', required: true }],
    currentConversationId: '123',
    currentConversationInputs: { text_var: 'current-value' },
    newConversationInputs: { text_var: 'new-value' },
    newConversationInputsRef: { current: { text_var: 'ref-value' } } as React.RefObject<Record<string, unknown>>,
    setCurrentConversationInputs: mockSetCurrentConversationInputs,
    handleNewConversationInputsChange: mockHandleNewConversationInputsChange,
    allInputsHidden: false,
    appPrevChatTree: [],
    pinnedConversationList: [],
    conversationList: [],
    handleNewConversation: vi.fn(),
    handleStartChat: vi.fn(),
    handleChangeConversation: vi.fn(),
    handlePinConversation: vi.fn(),
    handleUnpinConversation: vi.fn(),
    handleDeleteConversation: vi.fn(),
    conversationRenaming: false,
    handleRenameConversation: vi.fn(),
    handleNewConversationCompleted: vi.fn(),
    chatShouldReloadKey: '',
    isMobile: false,
    isInstalledApp: false,
    handleFeedback: vi.fn(),
    currentChatInstanceRef: { current: { handleStop: vi.fn() } } as React.RefObject<{ handleStop: () => void }>,
    sidebarCollapseState: false,
    handleSidebarCollapse: vi.fn(),
    setClearChatList: vi.fn(),
    setIsResponding: vi.fn(),
    ...overrides,
  }
  return base
}

describe('InputsFormContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders only visible forms and ignores hidden ones', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [
          { variable: 'text_var', type: InputVarType.textInput, label: 'Text Label', required: true },
          { variable: 'hidden_var', type: InputVarType.textInput, label: 'Hidden', hide: true },
        ],
      }),
    )

    render(<InputsFormContent />)

    expect(screen.getByText('Text Label')).toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('shows optional label when required is false', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'opt', type: InputVarType.textInput, label: 'Opt', required: false }],
      }),
    )

    render(<InputsFormContent />)

    expect(screen.getByText('workflow.panel.optional')).toBeInTheDocument()
  })

  it('uses currentConversationInputs when currentConversationId is present', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(createMockContext())
    render(<InputsFormContent />)
    const input = screen.getByPlaceholderText('Text Label') as HTMLInputElement
    expect(input.value).toBe('current-value')
  })

  it('falls back to newConversationInputs when currentConversationId is empty', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        currentConversationId: '',
        newConversationInputs: { text_var: 'new-value' },
      }),
    )

    render(<InputsFormContent />)
    const input = screen.getByPlaceholderText('Text Label') as HTMLInputElement
    expect(input.value).toBe('new-value')
  })

  it('updates both current and new inputs when form content changes', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(createMockContext())
    render(<InputsFormContent />)
    const input = screen.getByPlaceholderText('Text Label') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'updated' } })

    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ text_var: 'updated' }))
    expect(mockHandleNewConversationInputsChange).toHaveBeenCalledWith(expect.objectContaining({ text_var: 'updated' }))
  })

  it('renders and handles number input updates', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'num', type: InputVarType.number, label: 'Num' }],
        currentConversationInputs: {},
      }),
    )

    render(<InputsFormContent />)
    const input = screen.getByPlaceholderText('Num') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'number')

    fireEvent.change(input, { target: { value: '123' } })
    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ num: '123' }))
  })

  it('renders and handles paragraph input updates', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'para', type: InputVarType.paragraph, label: 'Para' }],
        currentConversationInputs: {},
      }),
    )

    render(<InputsFormContent />)
    const textarea = screen.getByPlaceholderText('Para') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello' } })
    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ para: 'hello' }))
  })

  it('renders and handles checkbox input updates (uses mocked BoolInput)', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'bool', type: InputVarType.checkbox, label: 'Bool' }],
      }),
    )

    render(<InputsFormContent />)
    const boolNode = screen.getByTestId('mock-bool-input')
    fireEvent.click(boolNode)
    expect(mockSetCurrentConversationInputs).toHaveBeenCalled()
  })

  it('handles select input with default value and updates', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'sel', type: InputVarType.select, label: 'Sel', options: ['A', 'B'], default: 'B' }],
        currentConversationInputs: {},
      }),
    )

    render(<InputsFormContent />)
    // Click Select to open
    fireEvent.click(screen.getByText('B'))

    // Now option A should be available
    const optionA = screen.getByText('A')
    fireEvent.click(optionA)

    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ sel: 'A' }))
  })

  it('handles select input with existing value (value not in options -> shows placeholder)', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'sel', type: InputVarType.select, label: 'Sel', options: ['A'], default: undefined }],
        currentConversationInputs: { sel: 'existing' },
      }),
    )

    render(<InputsFormContent />)
    const selNodes = screen.getAllByText('Sel')
    expect(selNodes.length).toBeGreaterThan(0)
    expect(screen.queryByText('existing')).toBeNull()
  })

  it('handles select input empty branches (no current value -> show placeholder)', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'sel', type: InputVarType.select, label: 'Sel', options: ['A'], default: undefined }],
        currentConversationInputs: {},
      }),
    )

    render(<InputsFormContent />)
    const selNodes = screen.getAllByText('Sel')
    expect(selNodes.length).toBeGreaterThan(0)
  })

  it('renders and handles JSON object updates (uses mocked CodeEditor)', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'json', type: InputVarType.jsonObject, label: 'Json', json_schema: '{ "a": 1 }' }],
        currentConversationInputs: {},
      }),
    )

    render(<InputsFormContent />)
    expect(screen.getByTestId('mock-code-editor-placeholder').textContent).toContain('{ "a": 1 }')

    const jsonEditor = screen.getByTestId('mock-code-editor') as HTMLTextAreaElement
    fireEvent.change(jsonEditor, { target: { value: '{"a":2}' } })
    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ json: '{"a":2}' }))
  })

  it('handles single file uploader with existing value (using mocked uploader)', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'single', type: InputVarType.singleFile, label: 'Single', allowed_file_types: [], allowed_file_extensions: [], allowed_file_upload_methods: [] }],
        currentConversationInputs: { single: 'file1' },
      }),
    )

    render(<InputsFormContent />)
    expect(screen.getByTestId('mock-file-uploader')).toHaveAttribute('data-value-count', '1')
  })

  it('handles single file uploader with no value and updates (using mocked uploader)', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'single', type: InputVarType.singleFile, label: 'Single', allowed_file_types: [], allowed_file_extensions: [], allowed_file_upload_methods: [] }],
        currentConversationInputs: {},
      }),
    )

    render(<InputsFormContent />)
    expect(screen.getByTestId('mock-file-uploader')).toHaveAttribute('data-value-count', '0')

    const uploader = screen.getByTestId('mock-file-uploader')
    fireEvent.click(uploader)
    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ single: 'uploaded-file-1' }))
  })

  it('renders and handles multi files uploader updates (using mocked uploader)', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(
      createMockContext({
        inputsForms: [{ variable: 'multi', type: InputVarType.multiFiles, label: 'Multi', max_length: 3 }],
        currentConversationInputs: {},
      }),
    )

    render(<InputsFormContent />)
    const uploader = screen.getByTestId('mock-file-uploader')
    fireEvent.click(uploader)
    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ multi: ['uploaded-file-1', 'uploaded-file-2'] }))
  })

  it('renders footer tip only when showTip prop is true', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue(createMockContext())
    const { rerender } = render(<InputsFormContent showTip={false} />)
    expect(screen.queryByText('share.chat.chatFormTip')).not.toBeInTheDocument()

    rerender(<InputsFormContent showTip={true} />)
    expect(screen.getByText('share.chat.chatFormTip')).toBeInTheDocument()
  })
})
