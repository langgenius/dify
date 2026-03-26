import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import type { Model } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import LeftPanel from '../left-panel'

const mockPromptEditor = vi.fn()
const mockChatView = vi.fn()
let mockLanguage = 'en-US'
let mockModelTriggerParams: Record<string, unknown> = {
  currentModel: { label: { en_US: 'GPT-4o' }, model: 'gpt-4o' },
  currentProvider: { provider: 'openai' },
  modelId: 'gpt-4o',
  disabled: false,
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: mockLanguage,
    },
  }),
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled }: { children: React.ReactNode, onClick?: () => void, disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: {
    value: string
    onChange: (value: string) => void
    onEnter: () => void
  }) => {
    mockPromptEditor(props)
    return (
      <div>
        <textarea aria-label="init-editor" value={props.value} onChange={e => props.onChange(e.target.value)} />
        <button type="button" onClick={props.onEnter}>editor-enter</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: ({ renderTrigger }: { renderTrigger: (params: Record<string, unknown>) => React.ReactNode }) => (
    <div data-testid="model-parameter-modal">
      {renderTrigger(mockModelTriggerParams)}
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-icon', () => ({
  default: () => <span data-testid="model-icon" />,
}))

vi.mock('@/app/components/base/skeleton', () => ({
  SkeletonRectangle: ({ className }: { className?: string }) => <div data-testid="skeleton-rectangle" className={className} />,
  SkeletonRow: ({ children }: { children: React.ReactNode }) => <div data-testid="skeleton-row">{children}</div>,
}))

vi.mock('../chat-view', () => ({
  default: (props: Record<string, unknown>) => {
    mockChatView(props)
    return <div data-testid="chat-view" />
  },
}))

const defaultModel: Model = {
  provider: 'openai',
  name: 'gpt-4o',
  mode: 'chat',
  completion_params: {},
} as Model

const availableNodes: Node[] = [
  {
    id: 'start-node',
    data: {
      title: 'Start',
      type: BlockEnum.Start,
      height: 120,
      width: 320,
      position: { x: 0, y: 0 },
    },
  } as Node,
]

const availableVars: NodeOutPutVar[] = [
  {
    nodeId: 'start-node',
    title: 'Start',
    vars: [],
  },
]

const renderLeftPanel = (overrides: Partial<React.ComponentProps<typeof LeftPanel>> = {}) => {
  const props: React.ComponentProps<typeof LeftPanel> = {
    isInitView: true,
    isGenerating: false,
    inputValue: '',
    onInputChange: vi.fn(),
    onGenerate: vi.fn(),
    onReset: vi.fn(),
    suggestedQuestions: ['How should I validate this payload?'],
    hasFetchedSuggestions: true,
    model: defaultModel,
    onModelChange: vi.fn(),
    onCompletionParamsChange: vi.fn(),
    promptMessages: [],
    versionOptions: [],
    currentVersionIndex: 0,
    onSelectVersion: vi.fn(),
    defaultAssistantMessage: 'Assistant default',
    availableVars,
    availableNodes,
    ...overrides,
  }

  return {
    ...render(<LeftPanel {...props} />),
    props,
  }
}

describe('LeftPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguage = 'en-US'
    mockModelTriggerParams = {
      currentModel: { label: { en_US: 'GPT-4o' }, model: 'gpt-4o' },
      currentProvider: { provider: 'openai' },
      modelId: 'gpt-4o',
      disabled: false,
    }
  })

  it('should render the init view and let users reuse a suggested question', () => {
    const { props } = renderLeftPanel()

    expect(screen.getByText('nodes.tool.contextGenerate.title')).toBeInTheDocument()
    expect(screen.getByText('nodes.tool.contextGenerate.subtitle')).toBeInTheDocument()
    expect(screen.getByText('How should I validate this payload?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('How should I validate this payload?'))

    expect(props.onInputChange).toHaveBeenCalledWith('How should I validate this payload?')
  })

  it('should show skeletons before suggestions are fetched and switch to chat mode later', () => {
    const { props } = renderLeftPanel({
      hasFetchedSuggestions: false,
    })

    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(3)

    renderLeftPanel({
      isInitView: false,
      promptMessages: [{ id: 'assistant-1', role: 'assistant', content: 'Done' }],
      versionOptions: [{ index: 0, label: 'Version 1' }],
    })

    expect(screen.getByTestId('chat-view')).toBeInTheDocument()
    expect(props.onReset).not.toHaveBeenCalled()
    expect(mockChatView).toHaveBeenCalledWith(expect.objectContaining({
      defaultAssistantMessage: 'Assistant default',
    }))
  })

  it('should wire init editor submission and forward workflow variables to the prompt editor', () => {
    mockModelTriggerParams = {
      currentModel: { model: 'fallback-model' },
      currentProvider: { provider: 'openai' },
      modelId: 'fallback-model',
      disabled: true,
    }

    const { props } = renderLeftPanel({
      inputValue: 'Plan the extractor',
      availableNodes: [
        ...availableNodes,
        {
          id: 'llm-node',
          data: {
            title: 'LLM',
            type: BlockEnum.LLM,
            height: 100,
            width: 200,
            position: { x: 10, y: 10 },
          },
        } as Node,
      ],
    })

    fireEvent.change(screen.getByLabelText('init-editor'), { target: { value: 'Rewrite the prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'editor-enter' }))

    expect(props.onInputChange).toHaveBeenCalledWith('Rewrite the prompt')
    expect(props.onGenerate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('fallback-model')).toBeInTheDocument()
    expect(mockPromptEditor).toHaveBeenLastCalledWith(expect.objectContaining({
      workflowVariableBlock: expect.objectContaining({
        workflowNodesMap: expect.objectContaining({
          'start-node': expect.objectContaining({ title: 'Start' }),
          'sys': expect.objectContaining({ title: 'blocks.start' }),
          'llm-node': expect.objectContaining({ title: 'LLM' }),
        }),
      }),
    }))
  })

  it('should render fallback model labels and reset from the chat header when not in init view', () => {
    const onReset = vi.fn()

    renderLeftPanel({
      isInitView: false,
      isGenerating: true,
      onReset,
      promptMessages: [{ id: 'assistant-1', role: 'assistant', content: 'Done' }],
      versionOptions: [{ index: 0, label: 'Version 1' }],
    })

    fireEvent.click(screen.getAllByRole('button')[0]!)

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(mockChatView).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({
        name: 'gpt-4o',
      }),
    }))
  })

  it('should fall back through model id and model name when translated labels are unavailable', () => {
    mockLanguage = ''
    mockModelTriggerParams = {
      currentModel: { label: { en_US: 'Fallback label' } },
      currentProvider: { provider: 'openai' },
      modelId: '',
      disabled: false,
    }

    const { rerender } = render(
      <LeftPanel
        isInitView
        isGenerating={false}
        inputValue=""
        onInputChange={vi.fn()}
        onGenerate={vi.fn()}
        onReset={vi.fn()}
        suggestedQuestions={[]}
        hasFetchedSuggestions
        model={{ ...defaultModel, name: 'model-name-fallback' }}
        onModelChange={vi.fn()}
        onCompletionParamsChange={vi.fn()}
        promptMessages={[]}
        versionOptions={[]}
        currentVersionIndex={0}
        onSelectVersion={vi.fn()}
        defaultAssistantMessage="Assistant default"
        availableVars={availableVars}
        availableNodes={availableNodes}
      />,
    )

    expect(screen.getByText('Fallback label')).toBeInTheDocument()

    mockModelTriggerParams = {
      currentModel: {},
      currentProvider: { provider: 'openai' },
      modelId: 'model-id-fallback',
      disabled: false,
    }

    rerender(
      <LeftPanel
        isInitView
        isGenerating={false}
        inputValue=""
        onInputChange={vi.fn()}
        onGenerate={vi.fn()}
        onReset={vi.fn()}
        suggestedQuestions={[]}
        hasFetchedSuggestions
        model={{ ...defaultModel, name: 'model-name-fallback' }}
        onModelChange={vi.fn()}
        onCompletionParamsChange={vi.fn()}
        promptMessages={[]}
        versionOptions={[]}
        currentVersionIndex={0}
        onSelectVersion={vi.fn()}
        defaultAssistantMessage="Assistant default"
        availableVars={availableVars}
        availableNodes={availableNodes}
      />,
    )

    expect(screen.getByText('model-id-fallback')).toBeInTheDocument()

    mockModelTriggerParams = {
      currentModel: {},
      currentProvider: { provider: 'openai' },
      modelId: '',
      disabled: false,
    }

    rerender(
      <LeftPanel
        isInitView
        isGenerating={false}
        inputValue=""
        onInputChange={vi.fn()}
        onGenerate={vi.fn()}
        onReset={vi.fn()}
        suggestedQuestions={[]}
        hasFetchedSuggestions
        model={{ ...defaultModel, name: 'model-name-fallback' }}
        onModelChange={vi.fn()}
        onCompletionParamsChange={vi.fn()}
        promptMessages={[]}
        versionOptions={[]}
        currentVersionIndex={0}
        onSelectVersion={vi.fn()}
        defaultAssistantMessage="Assistant default"
        availableVars={availableVars}
        availableNodes={availableNodes}
      />,
    )

    expect(screen.getByText('model-name-fallback')).toBeInTheDocument()
  })
})
