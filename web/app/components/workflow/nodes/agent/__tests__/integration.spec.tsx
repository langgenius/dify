/* eslint-disable ts/no-explicit-any, style/jsx-one-expression-per-line */
import type { AgentNodeType } from '../types'
import type { StrategyParamItem } from '@/app/components/plugins/types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum } from '@/app/components/workflow/types'
import { VarType as ToolVarType } from '../../tool/types'
import { ModelBar } from '../components/model-bar'
import { ToolIcon } from '../components/tool-icon'
import Node from '../node'
import Panel from '../panel'
import { AgentFeature } from '../types'
import useConfig from '../use-config'

let mockTextGenerationModels: Array<{ provider: string, models: Array<{ model: string }> }> | undefined = []
let mockModerationModels: Array<{ provider: string, models: Array<{ model: string }> }> | undefined = []
let mockRerankModels: Array<{ provider: string, models: Array<{ model: string }> }> | undefined = []
let mockSpeech2TextModels: Array<{ provider: string, models: Array<{ model: string }> }> | undefined = []
let mockTextEmbeddingModels: Array<{ provider: string, models: Array<{ model: string }> }> | undefined = []
let mockTtsModels: Array<{ provider: string, models: Array<{ model: string }> }> | undefined = []

let mockBuiltInTools: Array<any> | undefined = []
let mockCustomTools: Array<any> | undefined = []
let mockWorkflowTools: Array<any> | undefined = []
let mockMcpTools: Array<any> | undefined = []
let mockMarketplaceIcon: string | Record<string, string> | undefined

const mockResetEditor = vi.fn()

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: (modelType: ModelTypeEnum) => {
    if (modelType === ModelTypeEnum.textGeneration)
      return { data: mockTextGenerationModels }
    if (modelType === ModelTypeEnum.moderation)
      return { data: mockModerationModels }
    if (modelType === ModelTypeEnum.rerank)
      return { data: mockRerankModels }
    if (modelType === ModelTypeEnum.speech2text)
      return { data: mockSpeech2TextModels }
    if (modelType === ModelTypeEnum.textEmbedding)
      return { data: mockTextEmbeddingModels }
    return { data: mockTtsModels }
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ defaultModel, modelList }: any) => (
    <div>{defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'no-model'}:{modelList.length}</div>
  ),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: any) => <div>{`indicator:${color}`}</div>,
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockBuiltInTools }),
  useAllCustomTools: () => ({ data: mockCustomTools }),
  useAllWorkflowTools: () => ({ data: mockWorkflowTools }),
  useAllMCPTools: () => ({ data: mockMcpTools }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ icon, background }: any) => <div>{`app-icon:${background}:${icon}`}</div>,
}))

vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  Group: () => <div>group-icon</div>,
}))

vi.mock('@/utils/get-icon', () => ({
  getIconFromMarketPlace: () => mockMarketplaceIcon,
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (value: string) => value,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/group', () => ({
  Group: ({ label, children }: any) => <div><div>{label}</div>{children}</div>,
  GroupLabel: ({ className, children }: any) => <div className={className}>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/setting-item', () => ({
  SettingItem: ({ label, status, tooltip, children }: any) => <div>{label}:{status}:{tooltip}:{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, children }: any) => <div><div>{title}</div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/agent-strategy', () => ({
  AgentStrategy: ({ onStrategyChange }: any) => (
    <button
      type="button"
      onClick={() => onStrategyChange({
        agent_strategy_provider_name: 'provider/updated',
        agent_strategy_name: 'updated-strategy',
        agent_strategy_label: 'Updated Strategy',
        agent_output_schema: { properties: { extra: { type: 'string', description: 'extra output' } } },
        plugin_unique_identifier: 'provider/updated:1.0.0',
        meta: { version: '2.0.0' },
      })}
    >
      change-strategy
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  MCPToolAvailabilityProvider: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/memory-config', () => ({
  default: ({ onChange }: any) => <button type="button" onClick={() => onChange({ window: { enabled: true, size: 8 }, query_prompt_template: 'history' })}>change-memory</button>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({ children }: any) => <div>{children}</div>,
  VarItem: ({ name, type, description }: any) => <div>{`${name}:${type}:${description}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { setControlPromptEditorRerenderKey: typeof mockResetEditor }) => unknown) => selector({
    setControlPromptEditorRerenderKey: mockResetEditor,
  }),
}))

vi.mock('@/utils/plugin-version-feature', () => ({
  isSupportMCP: () => true,
}))

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createStrategyParam = (
  name: string,
  type: FormTypeEnum,
  required: boolean,
): StrategyParamItem => ({
  name,
  type,
  required,
  label: { en_US: name } as StrategyParamItem['label'],
  help: { en_US: `${name} help` } as StrategyParamItem['help'],
  placeholder: { en_US: `${name} placeholder` } as StrategyParamItem['placeholder'],
  scope: 'global',
  default: null,
  options: [],
  template: { enabled: false },
  auto_generate: { type: 'none' },
})

const createData = (overrides: Partial<AgentNodeType> = {}): AgentNodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.Agent,
  output_schema: {},
  agent_strategy_provider_name: 'provider/agent',
  agent_strategy_name: 'react',
  agent_strategy_label: 'React Agent',
  agent_parameters: {
    modelParam: { type: ToolVarType.constant, value: { provider: 'openai', model: 'gpt-4o' } },
    toolParam: { type: ToolVarType.constant, value: { provider_name: 'author/tool-a' } },
    multiToolParam: { type: ToolVarType.constant, value: [{ provider_name: 'author/tool-b' }] },
  },
  meta: { version: '1.0.0' } as any,
  plugin_unique_identifier: 'provider/agent:1.0.0',
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  setInputs: vi.fn(),
  handleVarListChange: vi.fn(),
  handleAddVariable: vi.fn(),
  currentStrategy: {
    identity: {
      author: 'provider',
      name: 'react',
      icon: 'icon',
      label: { en_US: 'React Agent' } as any,
      provider: 'provider/agent',
    },
    parameters: [
      createStrategyParam('modelParam', FormTypeEnum.modelSelector, true),
      createStrategyParam('optionalModel', FormTypeEnum.modelSelector, false),
      createStrategyParam('toolParam', FormTypeEnum.toolSelector, false),
      createStrategyParam('multiToolParam', FormTypeEnum.multiToolSelector, false),
    ],
    description: { en_US: 'agent description' } as any,
    output_schema: {},
    features: [AgentFeature.HISTORY_MESSAGES],
  },
  formData: {},
  onFormChange: vi.fn(),
  currentStrategyStatus: {
    plugin: { source: 'marketplace', installed: true },
    isExistInPlugin: false,
  },
  strategyProvider: undefined,
  pluginDetail: {
    declaration: {
      label: 'Mock Plugin',
    },
  } as any,
  availableVars: [],
  availableNodesWithParent: [],
  outputSchema: [{ name: 'jsonField', type: 'String', description: 'json output' }],
  handleMemoryChange: vi.fn(),
  isChatMode: true,
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

describe('agent path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTextGenerationModels = [{ provider: 'openai', models: [{ model: 'gpt-4o' }] }]
    mockModerationModels = []
    mockRerankModels = []
    mockSpeech2TextModels = []
    mockTextEmbeddingModels = []
    mockTtsModels = []
    mockBuiltInTools = [{ name: 'author/tool-a', is_team_authorization: true, icon: 'https://example.com/icon-a.png' }]
    mockCustomTools = []
    mockWorkflowTools = [{ id: 'author/tool-b', is_team_authorization: false, icon: { content: 'B', background: '#fff' } }]
    mockMcpTools = []
    mockMarketplaceIcon = 'https://example.com/marketplace.png'
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  describe('Path Integration', () => {
    it('should render model bars for missing, installed, and missing-install models', () => {
      const { rerender, container } = render(<ModelBar />)

      expect(container).toHaveTextContent('no-model:0')
      expect(screen.getByText('indicator:red')).toBeInTheDocument()

      rerender(<ModelBar provider="openai" model="gpt-4o" />)
      expect(container).toHaveTextContent('openai/gpt-4o:1')
      expect(screen.queryByText('indicator:red')).not.toBeInTheDocument()

      rerender(<ModelBar provider="openai" model="gpt-4.1" />)
      expect(container).toHaveTextContent('openai/gpt-4.1:1')
      expect(screen.getByText('indicator:red')).toBeInTheDocument()
    })

    it('should render tool icons across loading, marketplace fallback, authorization warning, and fetch-error states', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<ToolIcon id="tool-0" providerName="author/tool-a" />)

      expect(screen.getByRole('img', { name: 'tool icon' })).toBeInTheDocument()

      fireEvent.error(screen.getByRole('img', { name: 'tool icon' }))
      expect(screen.getByText('group-icon')).toBeInTheDocument()

      unmount()
      const secondRender = render(<ToolIcon id="tool-1" providerName="author/tool-b" />)
      expect(screen.getByText('app-icon:#fff:B')).toBeInTheDocument()
      expect(screen.getByText('indicator:yellow')).toBeInTheDocument()

      mockBuiltInTools = undefined
      secondRender.rerender(<ToolIcon id="tool-2" providerName="author/tool-c" />)
      expect(screen.getByText('group-icon')).toBeInTheDocument()

      mockBuiltInTools = []
      secondRender.rerender(<ToolIcon id="tool-3" providerName="market/tool-d" />)
      expect(screen.getByRole('img', { name: 'tool icon' })).toBeInTheDocument()
      await user.unhover(screen.getByRole('img', { name: 'tool icon' }))
    })

    it('should render strategy, models, and toolbox entries in the node', () => {
      const { container } = render(
        <Node
          id="agent-node"
          data={createData()}
        />,
      )

      expect(screen.getByText(/workflow\.nodes\.agent\.strategy\.shortLabel/)).toBeInTheDocument()
      expect(container).toHaveTextContent('React Agent')
      expect(screen.getByText('workflow.nodes.agent.model')).toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.agent.toolbox')).toBeInTheDocument()
      expect(container).toHaveTextContent('openai/gpt-4o:1')
      expect(screen.getByText('indicator:yellow')).toBeInTheDocument()
    })

    it('should render the panel, update the selected strategy, and expose memory plus output vars', async () => {
      const user = userEvent.setup()
      const config = createConfigResult()
      mockUseConfig.mockReturnValue(config)

      render(
        <Panel
          id="agent-node"
          data={createData()}
          panelProps={panelProps}
        />,
      )

      expect(screen.getByText('workflow.nodes.agent.strategy.label')).toBeInTheDocument()
      expect(screen.getByText('text:String:workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
      expect(screen.getByText('jsonField:String:json output')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'change-strategy' }))
      expect(config.setInputs).toHaveBeenCalledWith(expect.objectContaining({
        agent_strategy_provider_name: 'provider/updated',
        agent_strategy_name: 'updated-strategy',
        agent_strategy_label: 'Updated Strategy',
        plugin_unique_identifier: 'provider/updated:1.0.0',
      }))
      expect(mockResetEditor).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'change-memory' }))
      expect(config.handleMemoryChange).toHaveBeenCalledWith({
        window: { enabled: true, size: 8 },
        query_prompt_template: 'history',
      })
    })
  })
})
