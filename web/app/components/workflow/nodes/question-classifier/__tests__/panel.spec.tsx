import type { QuestionClassifierNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'
import useConfig from '../use-config'

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  __esModule: true,
  default: ({
    setModel,
    onCompletionParamsChange,
  }: {
    setModel: (model: { provider: string, modelId: string, mode?: string }) => void
    onCompletionParamsChange: (params: Record<string, unknown>) => void
  }) => (
    <div>
      <button type="button" onClick={() => setModel({ provider: 'openai', modelId: 'gpt-4o', mode: 'chat' })}>set-model</button>
      <button type="button" onClick={() => onCompletionParamsChange({ temperature: 0.2 })}>set-params</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (value: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['node-1', 'query'])}>var-picker</button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/config-vision', () => ({
  __esModule: true,
  default: ({
    onEnabledChange,
    onConfigChange,
  }: {
    onEnabledChange: (enabled: boolean) => void
    onConfigChange: (value: { resolution: string }) => void
  }) => (
    <div>
      <button type="button" onClick={() => onEnabledChange(true)}>vision-toggle</button>
      <button type="button" onClick={() => onConfigChange({ resolution: 'high' })}>vision-config</button>
    </div>
  ),
}))

vi.mock('../components/class-list', () => ({
  __esModule: true,
  default: () => <div>class-list</div>,
}))

vi.mock('../components/advanced-setting', () => ({
  __esModule: true,
  default: () => <div>advanced-setting</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type }: { name: string, type: string }) => <div>{`${name}:${type}`}</div>,
}))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createData = (overrides: Partial<QuestionClassifierNodeType> = {}): QuestionClassifierNodeType => ({
  title: 'Question Classifier',
  desc: '',
  type: BlockEnum.QuestionClassifier,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  } as QuestionClassifierNodeType['model'],
  classes: [{ id: 'topic-1', name: 'Billing questions' }],
  query_variable_selector: ['node-1', 'query'],
  instruction: 'Route by topic',
  vision: {
    enabled: false,
  },
  ...overrides,
})

const panelProps = {} as PanelProps

describe('question-classifier/panel', () => {
  const handleModelChanged = vi.fn()
  const handleCompletionParamsChange = vi.fn()
  const handleQueryVarChange = vi.fn()
  const handleVisionResolutionEnabledChange = vi.fn()
  const handleVisionResolutionChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue({
      readOnly: false,
      inputs: createData(),
      handleModelChanged,
      isChatMode: true,
      isChatModel: true,
      handleCompletionParamsChange,
      handleQueryVarChange,
      handleTopicsChange: vi.fn(),
      hasSetBlockStatus: { context: false, history: false, query: false },
      availableVars: [],
      availableNodesWithParent: [],
      availableVisionVars: [],
      handleInstructionChange: vi.fn(),
      handleMemoryChange: vi.fn(),
      isVisionModel: true,
      handleVisionResolutionEnabledChange,
      handleVisionResolutionChange,
      filterVar: vi.fn(() => true),
      handleSortTopic: vi.fn(),
    } as ReturnType<typeof useConfig>)
  })

  it('wires panel actions and renders output variables', async () => {
    const user = userEvent.setup()

    render(
      <Panel
        id="node-1"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'set-model' }))
    await user.click(screen.getByRole('button', { name: 'set-params' }))
    await user.click(screen.getByRole('button', { name: 'var-picker' }))
    await user.click(screen.getByRole('button', { name: 'vision-toggle' }))
    await user.click(screen.getByRole('button', { name: 'vision-config' }))

    expect(handleModelChanged).toHaveBeenCalledWith({ provider: 'openai', modelId: 'gpt-4o', mode: 'chat' })
    expect(handleCompletionParamsChange).toHaveBeenCalledWith({ temperature: 0.2 })
    expect(handleQueryVarChange).toHaveBeenCalledWith(['node-1', 'query'])
    expect(handleVisionResolutionEnabledChange).toHaveBeenCalledWith(true)
    expect(handleVisionResolutionChange).toHaveBeenCalledWith({ resolution: 'high' })
    expect(screen.getByText('class_name:string')).toBeInTheDocument()
    expect(screen.getByText('class_label:string')).toBeInTheDocument()
    expect(screen.getByText('usage:object')).toBeInTheDocument()
  })
})
