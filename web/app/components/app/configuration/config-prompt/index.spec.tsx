import type { IPromptProps } from './index'
import type { PromptItem, PromptVariable } from '@/models/debug'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { MAX_PROMPT_MESSAGE_LENGTH } from '@/config'
import ConfigContext from '@/context/debug-configuration'
import { PromptRole } from '@/models/debug'
import { AppModeEnum, ModelModeType } from '@/types/app'
import Prompt from './index'

type DebugConfiguration = {
  isAdvancedMode: boolean
  currentAdvancedPrompt: PromptItem | PromptItem[]
  setCurrentAdvancedPrompt: (prompt: PromptItem | PromptItem[], isUserChanged?: boolean) => void
  modelModeType: ModelModeType
  dataSets: Array<{
    id: string
    name?: string
  }>
  hasSetBlockStatus: {
    context: boolean
    history: boolean
    query: boolean
  }
}

const defaultPromptVariables: PromptVariable[] = [
  { key: 'var', name: 'Variable', type: 'string', required: true },
]

let mockSimplePromptInputProps: IPromptProps | null = null

vi.mock('./simple-prompt-input', () => ({
  default: (props: IPromptProps) => {
    mockSimplePromptInputProps = props
    return (
      <div
        data-testid="simple-prompt-input"
        data-mode={props.mode}
        data-template={props.promptTemplate}
        data-readonly={props.readonly ?? false}
        data-no-title={props.noTitle ?? false}
        data-gradient-border={props.gradientBorder ?? false}
        data-editor-height={props.editorHeight ?? ''}
        data-no-resize={props.noResize ?? false}
        onClick={() => props.onChange?.('mocked prompt', props.promptVariables)}
      >
        SimplePromptInput Mock
      </div>
    )
  },
}))

type AdvancedMessageInputProps = {
  isChatMode: boolean
  type: PromptRole
  value: string
  onTypeChange: (value: PromptRole) => void
  canDelete: boolean
  onDelete: () => void
  onChange: (value: string) => void
  promptVariables: PromptVariable[]
  isContextMissing: boolean
  onHideContextMissingTip: () => void
  noResize?: boolean
}

vi.mock('./advanced-prompt-input', () => ({
  default: (props: AdvancedMessageInputProps) => {
    return (
      <div
        data-testid="advanced-message-input"
        data-type={props.type}
        data-value={props.value}
        data-chat-mode={props.isChatMode}
        data-can-delete={props.canDelete}
        data-context-missing={props.isContextMissing}
      >
        <button type="button" onClick={() => props.onChange('updated text')}>
          change
        </button>
        <button type="button" onClick={() => props.onTypeChange(PromptRole.assistant)}>
          type
        </button>
        <button type="button" onClick={props.onDelete}>
          delete
        </button>
        <button type="button" onClick={props.onHideContextMissingTip}>
          hide-context
        </button>
      </div>
    )
  },
}))
const getContextValue = (overrides: Partial<DebugConfiguration> = {}): DebugConfiguration => {
  return {
    setCurrentAdvancedPrompt: vi.fn(),
    isAdvancedMode: false,
    currentAdvancedPrompt: [],
    modelModeType: ModelModeType.chat,
    dataSets: [],
    hasSetBlockStatus: {
      context: false,
      history: false,
      query: false,
    },
    ...overrides,
  }
}

const renderComponent = (
  props: Partial<IPromptProps> = {},
  contextOverrides: Partial<DebugConfiguration> = {},
) => {
  const mergedProps: IPromptProps = {
    mode: AppModeEnum.CHAT,
    promptTemplate: 'initial template',
    promptVariables: defaultPromptVariables,
    onChange: vi.fn(),
    ...props,
  }
  const contextValue = getContextValue(contextOverrides)

  return {
    contextValue,
    ...render(
      <ConfigContext.Provider value={contextValue as any}>
        <Prompt {...mergedProps} />
      </ConfigContext.Provider>,
    ),
  }
}

describe('Prompt config component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSimplePromptInputProps = null
  })

  // Rendering simple mode
  it('should render simple prompt when advanced mode is disabled', () => {
    const onChange = vi.fn()
    renderComponent({ onChange }, { isAdvancedMode: false })

    const simplePrompt = screen.getByTestId('simple-prompt-input')
    expect(simplePrompt).toBeInTheDocument()
    expect(simplePrompt).toHaveAttribute('data-mode', AppModeEnum.CHAT)
    expect(mockSimplePromptInputProps?.promptTemplate).toBe('initial template')
    fireEvent.click(simplePrompt)
    expect(onChange).toHaveBeenCalledWith('mocked prompt', defaultPromptVariables)
    expect(screen.queryByTestId('advanced-message-input')).toBeNull()
  })

  // Rendering advanced chat messages
  it('should render advanced chat prompts and show context missing tip when dataset context is not set', () => {
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: 'second' },
    ]
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        dataSets: [{ id: 'ds' } as unknown as DebugConfiguration['dataSets'][number]],
        hasSetBlockStatus: { context: false, history: true, query: true },
      },
    )

    const renderedMessages = screen.getAllByTestId('advanced-message-input')
    expect(renderedMessages).toHaveLength(2)
    expect(renderedMessages[0]).toHaveAttribute('data-context-missing', 'true')
    fireEvent.click(screen.getAllByText('hide-context')[0])
    expect(screen.getAllByTestId('advanced-message-input')[0]).toHaveAttribute('data-context-missing', 'false')
  })

  // Chat message mutations
  it('should update chat prompt value and call setter with user change flag', () => {
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: 'second' },
    ]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    fireEvent.click(screen.getAllByText('change')[0])
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith(
      [
        { role: PromptRole.user, text: 'updated text' },
        { role: PromptRole.assistant, text: 'second' },
      ],
      true,
    )
  })

  it('should update chat prompt role when type changes', () => {
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.user, text: 'second' },
    ]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    fireEvent.click(screen.getAllByText('type')[1])
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith(
      [
        { role: PromptRole.user, text: 'first' },
        { role: PromptRole.assistant, text: 'second' },
      ],
    )
  })

  it('should delete chat prompt item', () => {
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: 'second' },
    ]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    fireEvent.click(screen.getAllByText('delete')[0])
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith([{ role: PromptRole.assistant, text: 'second' }])
  })

  // Add message behavior
  it('should append a mirrored role message when clicking add in chat mode', () => {
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
    ]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    fireEvent.click(screen.getByText('appDebug.promptMode.operation.addMessage'))
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith([
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: '' },
    ])
  })

  it('should append a user role when the last chat prompt is from assistant', () => {
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.assistant, text: 'reply' },
    ]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    fireEvent.click(screen.getByText('appDebug.promptMode.operation.addMessage'))
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith([
      { role: PromptRole.assistant, text: 'reply' },
      { role: PromptRole.user, text: '' },
    ])
  })

  it('should insert a system message when adding to an empty chat prompt list', () => {
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt: [],
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    fireEvent.click(screen.getByText('appDebug.promptMode.operation.addMessage'))
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith([{ role: PromptRole.system, text: '' }])
  })

  it('should not show add button when reaching max prompt length', () => {
    const prompts: PromptItem[] = Array.from({ length: MAX_PROMPT_MESSAGE_LENGTH }, (_, index) => ({
      role: PromptRole.user,
      text: `item-${index}`,
    }))
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt: prompts,
        modelModeType: ModelModeType.chat,
      },
    )

    expect(screen.queryByText('appDebug.promptMode.operation.addMessage')).toBeNull()
  })

  // Completion mode
  it('should update completion prompt value and flag as user change', () => {
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt: { role: PromptRole.user, text: 'single' },
        modelModeType: ModelModeType.completion,
        setCurrentAdvancedPrompt,
      },
    )

    fireEvent.click(screen.getByText('change'))

    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith({ role: PromptRole.user, text: 'updated text' }, true)
  })
})
