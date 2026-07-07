import type { ReactNode } from 'react'
import type { Var } from '../../../types'
import type { Param, ParameterExtractorNodeType } from '../types'
import type { ToolParameter } from '@/app/components/tools/types'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type { PanelProps } from '@/types/workflow'
import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { CollectionType } from '@/app/components/tools/types'
import { AppModeEnum } from '@/types/app'
import { BlockEnum } from '../../../types'
import ImportFromTool from '../components/extract-parameter/import-from-tool'
import ExtractParameter from '../components/extract-parameter/list'
import AddExtractParameter from '../components/extract-parameter/update'
import ReasoningModePicker from '../components/reasoning-mode-picker'
import Node from '../node'
import Panel from '../panel'
import { ParamType, ReasoningModeType } from '../types'
import useConfig from '../use-config'

const reasoningModeFunctionToolCallingLabel = 'workflow.nodes.parameterExtractor.reasoningModeFunctionToolCalling'
const reasoningModePromptLabel = 'workflow.nodes.parameterExtractor.reasoningModePrompt'

type MockToolCollection = {
  id: string
  tools: Array<{
    name: string
    parameters: ToolParameter[]
  }>
}

let mockBuiltInTools: MockToolCollection[] = []
let mockCustomTools: MockToolCollection[] = []
let mockWorkflowTools: MockToolCollection[] = []
let mockSelectedToolInfo: ToolDefaultValue | undefined
let mockBlockSelectorOpen = false

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/app/components/workflow/block-selector', () => ({
  __esModule: true,
  default: ({
    trigger,
    onSelect,
  }: {
    trigger?: (open: boolean) => ReactNode
    onSelect?: (type: BlockEnum, value?: ToolDefaultValue) => void
  }) => (
    <button
      type="button"
      onClick={() => onSelect?.(BlockEnum.Tool, mockSelectedToolInfo)}
    >
      {trigger ? trigger(mockBlockSelectorOpen) : 'select-tool'}
    </button>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
  useTextGenerationCurrentProviderAndModelAndModelList: vi.fn(),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockBuiltInTools }),
  useAllCustomTools: () => ({ data: mockCustomTools }),
  useAllWorkflowTools: () => ({ data: mockWorkflowTools }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  __esModule: true,
  default: ({ defaultModel }: { defaultModel?: { provider: string, model: string } }) => (
    <div>{defaultModel ? `${defaultModel.provider}:${defaultModel.model}` : 'no-model'}</div>
  ),
}))

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
      <button
        type="button"
        onClick={() => setModel({ provider: 'anthropic', modelId: 'claude-3-7-sonnet', mode: AppModeEnum.CHAT })}
      >
        set-model
      </button>
      <button
        type="button"
        onClick={() => onCompletionParamsChange({ temperature: 0.2 })}
      >
        set-params
      </button>
    </div>
  ),
}))

vi.mock('@langgenius/dify-ui/dialog', () => ({
  __esModule: true,
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode
    open?: boolean
  }) => open !== false
    ? (
        <div data-testid="base-modal">
          {children}
        </div>
      )
    : null,
  DialogContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/collapse', () => ({
  FieldCollapse: ({ title, children }: { title: ReactNode, children: ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  __esModule: true,
  default: ({ title, operations, children }: { title: ReactNode, operations?: ReactNode, children: ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{operations}</div>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type }: { name: string, type: string }) => <div>{`${name}:${type}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  __esModule: true,
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/config-vision', () => ({
  __esModule: true,
  default: ({
    onEnabledChange,
    onConfigChange,
  }: {
    onEnabledChange: (enabled: boolean) => void
    onConfigChange: (value: { variable_selector: string[], detail: string }) => void
  }) => (
    <div>
      <button type="button" onClick={() => onEnabledChange(true)}>vision-toggle</button>
      <button type="button" onClick={() => onConfigChange({ variable_selector: ['node-1', 'image'], detail: 'high' })}>vision-config</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/memory-config', () => ({
  __esModule: true,
  default: ({
    onChange,
  }: {
    onChange: (value: { enabled: boolean }) => void
  }) => <button type="button" onClick={() => onChange({ enabled: true })}>memory-config</button>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  __esModule: true,
  default: ({
    title,
    value,
    onChange,
  }: {
    title: ReactNode
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      <div>{typeof title === 'string' ? title : 'editor-title'}</div>
      <textarea
        aria-label="instruction-editor"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: ({
    onChange,
  }: {
    onChange: (value: string[]) => void
  }) => <button type="button" onClick={() => onChange(['node-1', 'query'])}>pick-var</button>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/list-no-data-placeholder', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/option-card', () => ({
  __esModule: true,
  default: ({
    title,
    onSelect,
  }: {
    title: string
    onSelect: () => void
  }) => <button type="button" onClick={onSelect}>{title}</button>,
}))

vi.mock('@/app/components/app/configuration/config-var/config-modal/field', () => ({
  __esModule: true,
  default: ({ title, children }: { title: ReactNode, children: ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/app/configuration/config-var/config-select', () => ({
  __esModule: true,
  default: ({
    options,
    onChange,
  }: {
    options: string[]
    onChange: (value: string[]) => void
  }) => (
    <div>
      <div>{options.join(',')}</div>
      <button type="button" onClick={() => onChange([...options, 'published'])}>set-options</button>
    </div>
  ),
}))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseTextGeneration = vi.mocked(useTextGenerationCurrentProviderAndModelAndModelList)
const mockUseConfig = vi.mocked(useConfig)
const mockToastError = vi.mocked(toast.error)

const createToolParameter = (overrides: Partial<ToolParameter> = {}): ToolParameter => ({
  name: 'city',
  label: { en_US: 'City', zh_Hans: '城市' },
  human_description: { en_US: 'City input', zh_Hans: '城市输入' },
  type: ParamType.string,
  form: 'llm',
  llm_description: 'City name',
  required: true,
  multiple: false,
  default: '',
  options: [
    {
      value: 'draft',
      label: { en_US: 'Draft', zh_Hans: '草稿' },
    },
  ],
  ...overrides,
})

const createToolInfo = (overrides: Partial<ToolDefaultValue> = {}): ToolDefaultValue => ({
  provider_id: 'builtin-1',
  provider_type: CollectionType.builtIn,
  provider_name: 'builtin',
  tool_name: 'search',
  tool_label: 'Search',
  tool_description: 'Search tool',
  title: 'Search',
  is_team_authorization: false,
  params: {},
  paramSchemas: [],
  output_schema: {},
  ...overrides,
})

const createParam = (overrides: Partial<Param> = {}): Param => ({
  name: 'city',
  type: ParamType.string,
  description: 'City name',
  required: false,
  ...overrides,
})

const createData = (overrides: Partial<ParameterExtractorNodeType> = {}): ParameterExtractorNodeType => ({
  title: 'Parameter Extractor',
  desc: '',
  type: BlockEnum.ParameterExtractor,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  },
  query: ['node-1', 'query'],
  reasoning_mode: ReasoningModeType.prompt,
  parameters: [createParam()],
  instruction: 'Extract city and budget',
  vision: {
    enabled: false,
  },
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  handleInputVarChange: vi.fn(),
  filterVar: (_varPayload: Var) => true,
  isChatMode: true,
  inputs: createData(),
  isChatModel: true,
  isCompletionModel: false,
  handleModelChanged: vi.fn(),
  handleCompletionParamsChange: vi.fn(),
  handleImportFromTool: vi.fn(),
  handleExactParamsChange: vi.fn(),
  addExtractParameter: vi.fn(),
  handleInstructionChange: vi.fn(),
  hasSetBlockStatus: { history: false, query: false, context: false },
  availableVars: [],
  availableNodesWithParent: [],
  isSupportFunctionCall: true,
  handleReasoningModeChange: vi.fn(),
  handleMemoryChange: vi.fn(),
  isVisionModel: true,
  handleVisionResolutionEnabledChange: vi.fn(),
  handleVisionResolutionChange: vi.fn(),
  ...overrides,
})

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

describe('parameter-extractor path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToastError.mockClear()
    mockBuiltInTools = []
    mockCustomTools = []
    mockWorkflowTools = []
    mockSelectedToolInfo = createToolInfo()
    mockBlockSelectorOpen = false
    mockUseTextGeneration.mockReturnValue({
      currentProvider: undefined,
      currentModel: undefined,
      textGenerationModelList: [],
      activeTextGenerationModelList: [],
    } as unknown as ReturnType<typeof useTextGenerationCurrentProviderAndModelAndModelList>)
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  describe('Tool import and parameter editing', () => {
    it('should import llm parameters from the selected tool', async () => {
      const user = userEvent.setup()
      const onImport = vi.fn()

      mockBuiltInTools = [
        {
          id: 'builtin-1',
          tools: [
            {
              name: 'search',
              parameters: [
                createToolParameter(),
                createToolParameter({
                  name: 'internal_only',
                  form: 'form',
                }),
              ],
            },
          ],
        },
      ]

      render(<ImportFromTool onImport={onImport} />)

      await user.click(screen.getByRole('button', { name: /workflow.nodes.parameterExtractor.importFromTool/i }))

      expect(onImport).toHaveBeenCalledWith([
        {
          name: 'city',
          type: ParamType.string,
          required: true,
          description: 'City name',
          options: ['Draft'],
        },
      ])
    })

    it('should ignore invalid tool selections when importing parameters', async () => {
      const user = userEvent.setup()
      const onImport = vi.fn()

      mockSelectedToolInfo = undefined

      render(<ImportFromTool onImport={onImport} />)

      await user.click(screen.getByRole('button', { name: /workflow.nodes.parameterExtractor.importFromTool/i }))

      expect(onImport).not.toHaveBeenCalled()
    })

    it('should import llm parameters from custom and workflow tool collections', async () => {
      const user = userEvent.setup()
      const onImport = vi.fn()

      mockSelectedToolInfo = createToolInfo({
        provider_id: 'custom-1',
        provider_type: CollectionType.custom,
      })
      mockCustomTools = [
        {
          id: 'custom-1',
          tools: [
            {
              name: 'search',
              parameters: [createToolParameter({ name: 'custom_city', llm_description: 'Custom city' })],
            },
          ],
        },
      ]

      render(<ImportFromTool onImport={onImport} />)

      await user.click(screen.getByRole('button', { name: /workflow.nodes.parameterExtractor.importFromTool/i }))

      expect(onImport).toHaveBeenLastCalledWith([
        {
          name: 'custom_city',
          type: ParamType.string,
          required: true,
          description: 'Custom city',
          options: ['Draft'],
        },
      ])
    })

    it('should import llm parameters from workflow tool collections', async () => {
      const user = userEvent.setup()
      const onImport = vi.fn()

      mockSelectedToolInfo = createToolInfo({
        provider_id: 'workflow-1',
        provider_type: CollectionType.workflow,
        tool_name: 'transform',
      })
      mockWorkflowTools = [
        {
          id: 'workflow-1',
          tools: [
            {
              name: 'transform',
              parameters: [createToolParameter({ name: 'workflow_city', llm_description: 'Workflow city' })],
            },
          ],
        },
      ]

      render(<ImportFromTool onImport={onImport} />)
      await user.click(screen.getByRole('button', { name: /workflow.nodes.parameterExtractor.importFromTool/i }))

      expect(onImport).toHaveBeenLastCalledWith([
        {
          name: 'workflow_city',
          type: ParamType.string,
          required: true,
          description: 'Workflow city',
          options: ['Draft'],
        },
      ])
    })

    it('should highlight the trigger when open and return an empty import for unknown providers', async () => {
      const user = userEvent.setup()
      const onImport = vi.fn()

      mockBlockSelectorOpen = true
      mockSelectedToolInfo = createToolInfo({
        provider_type: 'unknown' as CollectionType,
      })

      render(<ImportFromTool onImport={onImport} />)

      expect(screen.getByText('workflow.nodes.parameterExtractor.importFromTool')).toHaveClass('bg-state-base-hover')

      await user.click(screen.getByRole('button', { name: /workflow.nodes.parameterExtractor.importFromTool/i }))

      expect(onImport).toHaveBeenCalledWith([])
    })

    it('should show the empty state for an empty parameter list', () => {
      render(
        <ExtractParameter
          readonly={false}
          list={[]}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByText('workflow.nodes.parameterExtractor.extractParametersNotSet')).toBeInTheDocument()
    })

    it('should edit and delete parameters from the list', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { container, rerender } = render(
        <ExtractParameter
          readonly={false}
          list={[createParam()]}
          onChange={onChange}
        />,
      )

      const editAndDeleteButtons = container.querySelectorAll('.cursor-pointer.rounded-md.p-1')
      fireEvent.click(editAndDeleteButtons[0] as HTMLElement)
      fireEvent.change(screen.getByDisplayValue('city'), { target: { value: 'city_name' } })
      fireEvent.change(screen.getByDisplayValue('City name'), { target: { value: 'Updated city description' } })
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onChange).toHaveBeenCalledWith([
        {
          name: 'city_name',
          type: ParamType.string,
          description: 'Updated city description',
          required: false,
        },
      ], undefined)

      onChange.mockClear()

      rerender(
        <ExtractParameter
          readonly={false}
          list={[createParam({ name: 'budget' })]}
          onChange={onChange}
        />,
      )

      const deleteButtons = container.querySelectorAll('.cursor-pointer.rounded-md.p-1')
      fireEvent.click(deleteButtons[1] as HTMLElement)

      expect(onChange).toHaveBeenCalledWith([])
    })

    it('should validate required fields before saving an incomplete parameter', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()

      render(
        <AddExtractParameter
          type="edit"
          payload={createParam({
            name: '',
            description: '',
          })}
          onSave={onSave}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onSave).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalled()
    })

    it('should render the add trigger for new parameters', () => {
      render(
        <AddExtractParameter
          type="add"
          onSave={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'workflow.nodes.parameterExtractor.addExtractParameter' })).toBeInTheDocument()
    })

    it('should reject invalid names and reset add modal fields after canceling', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()

      render(
        <AddExtractParameter
          type="add"
          onSave={vi.fn()}
          onCancel={onCancel}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'workflow.nodes.parameterExtractor.addExtractParameter' }))

      const nameInput = screen.getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder')
      const descriptionInput = screen.getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.descriptionPlaceholder')

      fireEvent.change(nameInput, { target: { value: '1bad' } })
      expect(mockToastError).toHaveBeenCalled()
      expect(nameInput).toHaveValue('')

      fireEvent.change(nameInput, { target: { value: 'temporary_name' } })
      fireEvent.change(descriptionInput, { target: { value: 'Temporary description' } })

      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('base-modal')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'workflow.nodes.parameterExtractor.addExtractParameter' }))
      expect(screen.getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder')).toHaveValue('')
      expect(screen.getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.descriptionPlaceholder')).toHaveValue('')
    })

    it('should require select options before saving a select parameter', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()

      render(
        <AddExtractParameter
          type="edit"
          payload={createParam({
            name: 'status',
            type: ParamType.select,
            description: 'Status field',
            options: [],
          })}
          onSave={onSave}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onSave).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalled()
    })

    it('should keep rename metadata and updated options when editing a select parameter', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()

      render(
        <AddExtractParameter
          type="edit"
          payload={createParam({
            name: 'status',
            type: ParamType.select,
            description: 'Status',
            options: ['draft'],
          })}
          onSave={onSave}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('status'), {
        target: { value: 'approval_status' },
      })
      await user.click(screen.getByRole('button', { name: 'set-options' }))
      await user.click(await screen.findByRole('button', { name: 'common.operation.save' }))

      expect(onSave).toHaveBeenCalledWith({
        name: 'approval_status',
        type: ParamType.select,
        description: 'Status',
        options: ['draft', 'published'],
        required: false,
      }, undefined)
    })

    it('should persist rename metadata and required state for edited parameters', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()

      render(
        <AddExtractParameter
          type="edit"
          payload={createParam({
            name: 'status',
            description: 'Status description',
          })}
          onSave={onSave}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('status'), {
        target: { value: 'approval_status' },
      })
      await user.click(screen.getByRole('switch'))
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onSave).toHaveBeenCalledWith({
        name: 'approval_status',
        type: ParamType.string,
        description: 'Status description',
        required: true,
      }, undefined)
    })
  })

  describe('Node and panel integration', () => {
    it('should let users switch the reasoning mode', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <ReasoningModePicker
          type={ReasoningModeType.prompt}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByRole('button', { name: reasoningModeFunctionToolCallingLabel }))
      await user.click(screen.getByRole('button', { name: reasoningModePromptLabel }))

      expect(onChange).toHaveBeenNthCalledWith(1, ReasoningModeType.functionCall)
      expect(onChange).toHaveBeenNthCalledWith(2, ReasoningModeType.prompt)
    })

    it('should render the selected model on the node only when configured', () => {
      const { rerender } = render(
        <Node
          id="parameter-node"
          data={createData()}
        />,
      )

      expect(screen.getByText('openai:gpt-4o')).toBeInTheDocument()

      rerender(
        <Node
          id="parameter-node"
          data={createData({
            model: {
              provider: '',
              name: '',
              mode: AppModeEnum.CHAT,
              completion_params: {},
            },
          })}
        />,
      )

      expect(screen.queryByText('openai:gpt-4o')).not.toBeInTheDocument()
    })

    it('should wire panel actions across model, input, import, vision, memory, and outputs', async () => {
      const user = userEvent.setup()
      const handleModelChanged = vi.fn()
      const handleCompletionParamsChange = vi.fn()
      const handleInputVarChange = vi.fn()
      const handleImportFromTool = vi.fn()
      const handleInstructionChange = vi.fn()
      const handleMemoryChange = vi.fn()
      const handleReasoningModeChange = vi.fn()
      const handleVisionResolutionEnabledChange = vi.fn()
      const handleVisionResolutionChange = vi.fn()

      mockBuiltInTools = [
        {
          id: 'builtin-1',
          tools: [
            {
              name: 'search',
              parameters: [createToolParameter()],
            },
          ],
        },
      ]

      mockUseConfig.mockReturnValueOnce(createConfigResult({
        inputs: createData({
          parameters: [createParam({ name: 'city' }), createParam({ name: 'budget', type: ParamType.number })],
        }),
        handleModelChanged,
        handleCompletionParamsChange,
        handleInputVarChange,
        handleImportFromTool,
        handleInstructionChange,
        handleMemoryChange,
        handleReasoningModeChange,
        handleVisionResolutionEnabledChange,
        handleVisionResolutionChange,
      }))

      render(
        <Panel
          id="parameter-node"
          data={createData()}
          panelProps={panelProps}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'set-model' }))
      await user.click(screen.getByRole('button', { name: 'set-params' }))
      await user.click(screen.getByRole('button', { name: 'pick-var' }))
      await user.click(screen.getByRole('button', { name: /workflow.nodes.parameterExtractor.importFromTool/i }))
      await user.click(screen.getByRole('button', { name: 'vision-toggle' }))
      await user.click(screen.getByRole('button', { name: 'vision-config' }))
      fireEvent.change(screen.getByLabelText('instruction-editor'), {
        target: { value: 'Extract city, budget, and due date' },
      })
      await user.click(screen.getByRole('button', { name: 'memory-config' }))
      await user.click(screen.getByRole('button', { name: reasoningModeFunctionToolCallingLabel }))

      expect(handleModelChanged).toHaveBeenCalledWith({
        provider: 'anthropic',
        modelId: 'claude-3-7-sonnet',
        mode: AppModeEnum.CHAT,
      })
      expect(handleCompletionParamsChange).toHaveBeenCalledWith({ temperature: 0.2 })
      expect(handleInputVarChange).toHaveBeenCalledWith(['node-1', 'query'])
      expect(handleImportFromTool).toHaveBeenCalledWith([
        {
          name: 'city',
          type: ParamType.string,
          required: true,
          description: 'City name',
          options: ['Draft'],
        },
      ])
      expect(handleVisionResolutionEnabledChange).toHaveBeenCalledWith(true)
      expect(handleVisionResolutionChange).toHaveBeenCalledWith({
        variable_selector: ['node-1', 'image'],
        detail: 'high',
      })
      expect(handleInstructionChange).toHaveBeenCalledWith('Extract city, budget, and due date')
      expect(handleMemoryChange).toHaveBeenCalledWith({ enabled: true })
      expect(handleReasoningModeChange).toHaveBeenCalledWith(ReasoningModeType.functionCall)
      expect(screen.getByText('city:string')).toBeInTheDocument()
      expect(screen.getByText('budget:number')).toBeInTheDocument()
      expect(screen.getByText('__usage:object')).toBeInTheDocument()
    })
  })
})
