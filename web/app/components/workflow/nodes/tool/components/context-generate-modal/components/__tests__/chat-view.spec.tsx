import type { ContextGenerateChatMessage } from '../../hooks/use-context-generate'
import type { VersionOption } from '../../types'
import type { WorkflowVariableBlockType } from '@/app/components/base/prompt-editor/types'
import type { Model } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import ChatView from '../chat-view'

const mockPromptEditor = vi.fn()

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: {
    value: string
    editable: boolean
    onChange: (value: string) => void
    onEnter: () => void
  }) => {
    mockPromptEditor(props)
    return (
      <div>
        <textarea
          aria-label="prompt-editor"
          value={props.value}
          readOnly={!props.editable}
          onChange={e => props.onChange(e.target.value)}
        />
        <button type="button" onClick={props.onEnter}>enter</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: ({ renderTrigger }: { renderTrigger: (params: Record<string, unknown>) => React.ReactNode }) => (
    <div data-testid="model-parameter-modal">
      {renderTrigger({
        currentModel: { label: { en_US: 'GPT-4o' }, model: 'gpt-4o' },
        currentProvider: { provider: 'openai' },
        modelId: 'gpt-4o',
        disabled: false,
      })}
    </div>
  ),
}))

vi.mock('@/app/components/base/chat/chat/loading-anim', () => ({
  default: () => <div data-testid="loading-anim" />,
}))

const defaultMessages: ContextGenerateChatMessage[] = [
  { id: 'user-1', role: 'user', content: 'Summarize the docs' },
  { id: 'assistant-1', role: 'assistant', content: 'Version 1 result' },
]

const defaultVersionOptions: VersionOption[] = [
  { index: 0, label: 'Version 1' },
]

const defaultModel: Model = {
  provider: 'openai',
  name: 'gpt-4o',
  mode: 'chat',
  completion_params: {},
} as Model

const defaultWorkflowVariableBlock: WorkflowVariableBlockType = {
  show: true,
  variables: [],
  workflowNodesMap: {},
}

const renderChatView = (overrides: Partial<React.ComponentProps<typeof ChatView>> = {}) => {
  const props: React.ComponentProps<typeof ChatView> = {
    promptMessages: defaultMessages,
    versionOptions: defaultVersionOptions,
    currentVersionIndex: 0,
    onSelectVersion: vi.fn(),
    defaultAssistantMessage: 'Default assistant message',
    isGenerating: false,
    inputValue: '',
    onInputChange: vi.fn(),
    onGenerate: vi.fn(),
    model: defaultModel,
    onModelChange: vi.fn(),
    onCompletionParamsChange: vi.fn(),
    renderModelTrigger: () => <span>model trigger</span>,
    workflowVariableBlock: defaultWorkflowVariableBlock,
    ...overrides,
  }

  return {
    ...render(<ChatView {...props} />),
    props,
  }
}

describe('ChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render messages and allow selecting an assistant version', () => {
    const { props } = renderChatView()

    expect(screen.getByText('Summarize the docs')).toBeInTheDocument()
    expect(screen.getByText('Version 1 result')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Version 1' }))

    expect(props.onSelectVersion).toHaveBeenCalledWith(0)
  })

  it('should surface generating state and wire editor interactions', () => {
    const { props } = renderChatView({
      isGenerating: true,
      inputValue: 'Generate a prompt',
    })

    expect(screen.getByTestId('loading-anim')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.tool.contextGenerate.generating')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('prompt-editor'), { target: { value: 'Refine this' } })
    fireEvent.click(screen.getByRole('button', { name: 'enter' }))

    expect(props.onInputChange).toHaveBeenCalledWith('Refine this')
    expect(props.onGenerate).toHaveBeenCalledTimes(1)
  })

  it('should render fallback assistant content without a version selector when version metadata is missing', () => {
    renderChatView({
      promptMessages: [{ role: 'assistant', content: '' }],
      versionOptions: [],
      inputValue: ' ',
    })

    expect(screen.getByText('Default assistant message')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Version/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'enter' })).toBeInTheDocument()
  })

  it('should render an empty chat state without the generating indicator', () => {
    renderChatView({
      promptMessages: [],
      versionOptions: [],
      isGenerating: false,
    })

    expect(screen.queryByTestId('loading-anim')).not.toBeInTheDocument()
    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      editable: true,
      value: '',
    }))
  })

  it('should render selected and unselected assistant version cards', () => {
    renderChatView({
      promptMessages: [
        { role: 'assistant', content: 'Version 1 result' },
        { role: 'assistant', content: 'Version 2 result' },
      ],
      versionOptions: [
        { index: 0, label: 'Version 1' },
        { index: 1, label: 'Version 2' },
      ],
      currentVersionIndex: 1,
    })

    expect(screen.getByRole('button', { name: 'Version 1' })).toHaveClass('border-components-panel-border-subtle')
    expect(screen.getByRole('button', { name: 'Version 2' })).toHaveClass('border-components-option-card-option-selected-border')
  })
})
