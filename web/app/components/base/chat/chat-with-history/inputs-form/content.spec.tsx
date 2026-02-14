import type { ChatWithHistoryContextValue } from '../context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputVarType } from '@/app/components/workflow/types'
import InputsFormContent from './content'

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
      onClick={() => onChange(value && value.length > 0 ? [...value, `uploaded-file-${(value.length || 0) + 1}`] : ['uploaded-file-1'])}
      data-value-count={value?.length ?? 0}
    />
  ),
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

// Create a real context for testing to support controlled component behavior
const MockContext = React.createContext<ChatWithHistoryContextValue>(createMockContext())

vi.mock('../context', () => ({
  useChatWithHistoryContext: () => React.useContext(MockContext),
}))

const MockContextProvider = ({ children, value }: { children: React.ReactNode, value: ChatWithHistoryContextValue }) => {
  // We need to manage state locally to support controlled components
  const [currentInputs, setCurrentInputs] = React.useState(value.currentConversationInputs)
  const [newInputs, setNewInputs] = React.useState(value.newConversationInputs)

  const newInputsRef = React.useRef(newInputs)
  newInputsRef.current = newInputs

  const contextValue: ChatWithHistoryContextValue = {
    ...value,
    currentConversationInputs: currentInputs,
    newConversationInputs: newInputs,
    newConversationInputsRef: newInputsRef as React.RefObject<Record<string, unknown>>,
    setCurrentConversationInputs: (v: Record<string, unknown>) => {
      setCurrentInputs(v)
      value.setCurrentConversationInputs(v)
    },
    handleNewConversationInputsChange: (v: Record<string, unknown>) => {
      setNewInputs(v)
      value.handleNewConversationInputsChange(v)
    },
  }

  return <MockContext.Provider value={contextValue}>{children}</MockContext.Provider>
}

describe('InputsFormContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderWithContext = (component: React.ReactNode, contextValue: ChatWithHistoryContextValue) => {
    return render(
      <MockContextProvider value={contextValue}>
        {component}
      </MockContextProvider>,
    )
  }

  it('renders only visible forms and ignores hidden ones', () => {
    const context = createMockContext({
      inputsForms: [
        { variable: 'text_var', type: InputVarType.textInput, label: 'Text Label', required: true },
        { variable: 'hidden_var', type: InputVarType.textInput, label: 'Hidden', hide: true },
      ],
    })

    renderWithContext(<InputsFormContent />, context)

    expect(screen.getByText('Text Label')).toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('shows optional label when required is false', () => {
    const context = createMockContext({
      inputsForms: [{ variable: 'opt', type: InputVarType.textInput, label: 'Opt', required: false }],
    })

    renderWithContext(<InputsFormContent />, context)

    expect(screen.getByText('workflow.panel.optional')).toBeInTheDocument()
  })

  it('uses currentConversationInputs when currentConversationId is present', () => {
    const context = createMockContext()
    renderWithContext(<InputsFormContent />, context)
    const input = screen.getByPlaceholderText('Text Label') as HTMLInputElement
    expect(input.value).toBe('current-value')
  })

  it('falls back to newConversationInputs when currentConversationId is empty', () => {
    const context = createMockContext({
      currentConversationId: '',
      newConversationInputs: { text_var: 'new-value' },
    })

    renderWithContext(<InputsFormContent />, context)
    const input = screen.getByPlaceholderText('Text Label') as HTMLInputElement
    expect(input.value).toBe('new-value')
  })

  it('updates both current and new inputs when form content changes', async () => {
    const user = userEvent.setup()
    const context = createMockContext()
    renderWithContext(<InputsFormContent />, context)
    const input = screen.getByPlaceholderText('Text Label') as HTMLInputElement

    await user.clear(input)
    await user.type(input, 'updated')

    expect(mockSetCurrentConversationInputs).toHaveBeenLastCalledWith(expect.objectContaining({ text_var: 'updated' }))
    expect(mockHandleNewConversationInputsChange).toHaveBeenLastCalledWith(expect.objectContaining({ text_var: 'updated' }))
  })

  it('renders and handles number input updates', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      inputsForms: [{ variable: 'num', type: InputVarType.number, label: 'Num' }],
      currentConversationInputs: {},
    })

    renderWithContext(<InputsFormContent />, context)
    const input = screen.getByPlaceholderText('Num') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'number')

    await user.type(input, '123')

    expect(mockSetCurrentConversationInputs).toHaveBeenLastCalledWith(expect.objectContaining({ num: '123' }))
  })

  it('renders and handles paragraph input updates', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      inputsForms: [{ variable: 'para', type: InputVarType.paragraph, label: 'Para' }],
      currentConversationInputs: {},
    })

    renderWithContext(<InputsFormContent />, context)
    const textarea = screen.getByPlaceholderText('Para') as HTMLTextAreaElement
    await user.type(textarea, 'hello')

    expect(mockSetCurrentConversationInputs).toHaveBeenLastCalledWith(expect.objectContaining({ para: 'hello' }))
  })

  it('renders and handles checkbox input updates (uses mocked BoolInput)', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      inputsForms: [{ variable: 'bool', type: InputVarType.checkbox, label: 'Bool' }],
    })

    renderWithContext(<InputsFormContent />, context)
    const boolNode = screen.getByTestId('mock-bool-input')
    await user.click(boolNode)
    expect(mockSetCurrentConversationInputs).toHaveBeenCalled()
  })

  it('handles select input with default value and updates', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      inputsForms: [{ variable: 'sel', type: InputVarType.select, label: 'Sel', options: ['A', 'B'], default: 'B' }],
      currentConversationInputs: {},
    })

    renderWithContext(<InputsFormContent />, context)
    // Click Select to open
    await user.click(screen.getByText('B'))

    // Now option A should be available
    const optionA = screen.getByText('A')
    await user.click(optionA)

    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ sel: 'A' }))
  })

  it('handles select input with existing value (value not in options -> shows placeholder)', () => {
    const context = createMockContext({
      inputsForms: [{ variable: 'sel', type: InputVarType.select, label: 'Sel', options: ['A'], default: undefined }],
      currentConversationInputs: { sel: 'existing' },
    })

    renderWithContext(<InputsFormContent />, context)
    const selNodes = screen.getAllByText('Sel')
    expect(selNodes.length).toBeGreaterThan(0)
    expect(screen.queryByText('existing')).toBeNull()
  })

  it('handles select input empty branches (no current value -> show placeholder)', () => {
    const context = createMockContext({
      inputsForms: [{ variable: 'sel', type: InputVarType.select, label: 'Sel', options: ['A'], default: undefined }],
      currentConversationInputs: {},
    })

    renderWithContext(<InputsFormContent />, context)
    const selNodes = screen.getAllByText('Sel')
    expect(selNodes.length).toBeGreaterThan(0)
  })

  it('renders and handles JSON object updates (uses mocked CodeEditor)', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      inputsForms: [{ variable: 'json', type: InputVarType.jsonObject, label: 'Json', json_schema: '{ "a": 1 }' }],
      currentConversationInputs: {},
    })

    renderWithContext(<InputsFormContent />, context)
    expect(screen.getByTestId('mock-code-editor-placeholder').textContent).toContain('{ "a": 1 }')

    const jsonEditor = screen.getByTestId('mock-code-editor') as HTMLTextAreaElement
    await user.clear(jsonEditor)
    await user.paste('{"a":2}')
    expect(mockSetCurrentConversationInputs).toHaveBeenLastCalledWith(expect.objectContaining({ json: '{"a":2}' }))
  })

  it('handles single file uploader with existing value (using mocked uploader)', () => {
    const context = createMockContext({
      inputsForms: [{ variable: 'single', type: InputVarType.singleFile, label: 'Single', allowed_file_types: [], allowed_file_extensions: [], allowed_file_upload_methods: [] }],
      currentConversationInputs: { single: 'file1' },
    })

    renderWithContext(<InputsFormContent />, context)
    expect(screen.getByTestId('mock-file-uploader')).toHaveAttribute('data-value-count', '1')
  })

  it('handles single file uploader with no value and updates (using mocked uploader)', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      inputsForms: [{ variable: 'single', type: InputVarType.singleFile, label: 'Single', allowed_file_types: [], allowed_file_extensions: [], allowed_file_upload_methods: [] }],
      currentConversationInputs: {},
    })

    renderWithContext(<InputsFormContent />, context)
    expect(screen.getByTestId('mock-file-uploader')).toHaveAttribute('data-value-count', '0')

    const uploader = screen.getByTestId('mock-file-uploader')
    await user.click(uploader)
    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ single: 'uploaded-file-1' }))
  })

  it('renders and handles multi files uploader updates (using mocked uploader)', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      inputsForms: [{ variable: 'multi', type: InputVarType.multiFiles, label: 'Multi', max_length: 3 }],
      currentConversationInputs: {},
    })

    renderWithContext(<InputsFormContent />, context)
    const uploader = screen.getByTestId('mock-file-uploader')
    await user.click(uploader)

    expect(mockSetCurrentConversationInputs).toHaveBeenCalledWith(expect.objectContaining({ multi: ['uploaded-file-1'] }))
  })

  it('renders footer tip only when showTip prop is true', () => {
    const context = createMockContext()
    const { rerender } = renderWithContext(<InputsFormContent showTip={false} />, context)
    expect(screen.queryByText('share.chat.chatFormTip')).not.toBeInTheDocument()

    rerender(
      <MockContextProvider value={context}>
        <InputsFormContent showTip={true} />
      </MockContextProvider>,
    )
    expect(screen.getByText('share.chat.chatFormTip')).toBeInTheDocument()
  })
})
