import type { ParameterExtractorNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import Panel from '../panel'
import { ParamType, ReasoningModeType } from '../types'
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
      <button type="button" onClick={() => setModel({ provider: 'anthropic', modelId: 'claude-3-7-sonnet', mode: AppModeEnum.CHAT })}>set-model</button>
      <button type="button" onClick={() => onCompletionParamsChange({ temperature: 0.2 })}>set-params</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/collapse', () => ({
  __esModule: true,
  FieldCollapse: ({
    title,
    children,
  }: {
    title: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (value: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['node-1', 'query'])}>pick-var</button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/config-vision', () => ({
  __esModule: true,
  default: ({
    onEnabledChange,
    onConfigChange,
  }: {
    onEnabledChange: (enabled: boolean) => void
    onConfigChange: (value: { detail: string }) => void
  }) => (
    <div>
      <button type="button" onClick={() => onEnabledChange(true)}>vision-toggle</button>
      <button type="button" onClick={() => onConfigChange({ detail: 'high' })}>vision-config</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('Updated instruction')}>instruction-editor</button>
  ),
}))

vi.mock('../components/extract-parameter/import-from-tool', () => ({
  __esModule: true,
  default: ({ onImport }: { onImport: (params: unknown[]) => void }) => (
    <button type="button" onClick={() => onImport([{ name: 'budget' }])}>import-from-tool</button>
  ),
}))

vi.mock('../components/extract-parameter/list', () => ({
  __esModule: true,
  default: () => <div>extract-parameter-list</div>,
}))

vi.mock('../components/extract-parameter/update', () => ({
  __esModule: true,
  default: ({ onSave }: { onSave: (value: unknown) => void }) => (
    <button type="button" onClick={() => onSave({ name: 'city' })}>add-parameter</button>
  ),
}))

vi.mock('../components/reasoning-mode-picker', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (value: ReasoningModeType) => void }) => (
    <button type="button" onClick={() => onChange(ReasoningModeType.functionCall)}>set-reasoning-mode</button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/memory-config', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (value: { enabled: boolean }) => void }) => (
    <button type="button" onClick={() => onChange({ enabled: true })}>memory-config</button>
  ),
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

const createData = (overrides: Partial<ParameterExtractorNodeType> = {}): ParameterExtractorNodeType => ({
  title: 'Parameter Extractor',
  desc: '',
  type: BlockEnum.ParameterExtractor,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  } as ParameterExtractorNodeType['model'],
  query: ['node-1', 'query'],
  reasoning_mode: ReasoningModeType.prompt,
  parameters: [{
    name: 'city',
    type: ParamType.string,
    description: 'City name',
    required: false,
  }],
  instruction: 'Extract city and budget',
  vision: {
    enabled: false,
  },
  ...overrides,
})

const panelProps = {} as PanelProps

describe('parameter-extractor/panel', () => {
  const handleModelChanged = vi.fn()
  const handleCompletionParamsChange = vi.fn()
  const handleInputVarChange = vi.fn()
  const handleVisionResolutionEnabledChange = vi.fn()
  const handleVisionResolutionChange = vi.fn()
  const handleImportFromTool = vi.fn()
  const addExtractParameter = vi.fn()
  const handleInstructionChange = vi.fn()
  const handleMemoryChange = vi.fn()
  const handleReasoningModeChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue({
      readOnly: false,
      handleInputVarChange,
      filterVar: vi.fn(() => true),
      isChatMode: true,
      inputs: createData(),
      isChatModel: true,
      isCompletionModel: false,
      handleModelChanged,
      handleCompletionParamsChange,
      handleImportFromTool,
      handleExactParamsChange: vi.fn(),
      addExtractParameter,
      handleInstructionChange,
      hasSetBlockStatus: { history: false, query: false, context: false },
      availableVars: [],
      availableNodesWithParent: [],
      isSupportFunctionCall: true,
      handleReasoningModeChange,
      handleMemoryChange,
      isVisionModel: true,
      handleVisionResolutionEnabledChange,
      handleVisionResolutionChange,
    } as ReturnType<typeof useConfig>)
  })

  it('wires model, parameter, instruction, memory, and reasoning actions to use-config', async () => {
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
    await user.click(screen.getByRole('button', { name: 'pick-var' }))
    await user.click(screen.getByRole('button', { name: 'vision-toggle' }))
    await user.click(screen.getByRole('button', { name: 'vision-config' }))
    await user.click(screen.getByRole('button', { name: 'import-from-tool' }))
    await user.click(screen.getByRole('button', { name: 'add-parameter' }))
    await user.click(screen.getByRole('button', { name: 'instruction-editor' }))
    await user.click(screen.getByRole('button', { name: 'memory-config' }))
    await user.click(screen.getByRole('button', { name: 'set-reasoning-mode' }))

    expect(handleModelChanged).toHaveBeenCalledWith({ provider: 'anthropic', modelId: 'claude-3-7-sonnet', mode: AppModeEnum.CHAT })
    expect(handleCompletionParamsChange).toHaveBeenCalledWith({ temperature: 0.2 })
    expect(handleInputVarChange).toHaveBeenCalledWith(['node-1', 'query'])
    expect(handleVisionResolutionEnabledChange).toHaveBeenCalledWith(true)
    expect(handleVisionResolutionChange).toHaveBeenCalledWith({ detail: 'high' })
    expect(handleImportFromTool).toHaveBeenCalledWith([{ name: 'budget' }])
    expect(addExtractParameter).toHaveBeenCalledWith({ name: 'city' })
    expect(handleInstructionChange).toHaveBeenCalledWith('Updated instruction')
    expect(handleMemoryChange).toHaveBeenCalledWith({ enabled: true })
    expect(handleReasoningModeChange).toHaveBeenCalledWith(ReasoningModeType.functionCall)
    expect(screen.getByText('city:string')).toBeInTheDocument()
    expect(screen.getByText('__is_success:number')).toBeInTheDocument()
    expect(screen.getByText('__reason:string')).toBeInTheDocument()
    expect(screen.getByText('__usage:object')).toBeInTheDocument()
  })
})
