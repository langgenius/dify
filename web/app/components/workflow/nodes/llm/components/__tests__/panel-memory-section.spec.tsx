import type { LLMNodeType } from '../../types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import PanelMemorySection from '../panel-memory-section'

const mockEditor = vi.hoisted(() => vi.fn())
const mockMemoryConfig = vi.hoisted(() => vi.fn())

type EditorProps = {
  value?: string
  isChatApp?: boolean
  isChatModel?: boolean
  isShowContext?: boolean
}

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  __esModule: true,
  default: (props: EditorProps) => {
    mockEditor(props)
    return <div data-testid="editor">{props.value}</div>
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/memory-config', () => ({
  __esModule: true,
  default: (props: { canSetRoleName: boolean, config: { data?: LLMNodeType['memory'] } }) => {
    mockMemoryConfig(props)
    return <div data-testid="memory-config">{props.canSetRoleName ? 'can-set-role' : 'cannot-set-role'}</div>
  },
}))

const createInputs = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  title: 'LLM',
  desc: '',
  type: 'llm' as LLMNodeType['type'],
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  } as LLMNodeType['model'],
  prompt_template: [],
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
  memory: {
    window: {
      enabled: false,
      size: 10,
    },
    query_prompt_template: '',
  },
  ...overrides,
})

const baseProps = {
  readOnly: false,
  isChatMode: true,
  isChatModel: true,
  isCompletionModel: false,
  inputs: createInputs(),
  hasSetBlockStatus: {
    history: false,
    query: true,
    context: false,
  },
  availableVars: [] as NodeOutPutVar[],
  availableNodesWithParent: [] as Node[],
  handleSyeQueryChange: vi.fn(),
  handleMemoryChange: vi.fn(),
}

describe('llm/panel-memory-section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the built-in chat memory editor and memory config in chat mode', () => {
    render(<PanelMemorySection {...baseProps} />)

    expect(screen.getByText('workflow.nodes.common.memories.title')).toBeInTheDocument()
    expect(screen.getByTestId('editor')).toHaveTextContent('{{#sys.query#}}')
    expect(screen.getByTestId('memory-config')).toHaveTextContent('cannot-set-role')
    expect(mockEditor).toHaveBeenCalledWith(expect.objectContaining({
      isChatApp: true,
      isChatModel: true,
      isShowContext: false,
    }))
  })

  it('shows the sys query warning when the memory prompt omits the required placeholder', () => {
    render(
      <PanelMemorySection
        {...baseProps}
        inputs={createInputs({
          memory: {
            window: {
              enabled: false,
              size: 10,
            },
            query_prompt_template: 'custom prompt',
          },
        })}
      />,
    )

    expect(screen.getByText('workflow.nodes.llm.sysQueryInUser')).toBeInTheDocument()
    expect(screen.getByTestId('editor')).toHaveTextContent('custom prompt')
  })

  it('renders nothing outside chat mode', () => {
    render(
      <PanelMemorySection
        {...baseProps}
        isChatMode={false}
        isChatModel={false}
        isCompletionModel={true}
      />,
    )

    expect(screen.queryByText('workflow.nodes.common.memories.title')).not.toBeInTheDocument()
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
    expect(screen.queryByTestId('memory-config')).not.toBeInTheDocument()
  })
})
