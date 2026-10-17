import type {
  AgentStrategyParameter,
  GetWorkspacesCurrentModelsModelTypesByModelTypeData,
  ToolProviderListResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentProps } from 'react'
import type { AgentNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { zAgentStrategyParameter } from '@dify/contracts/api/console/workspaces/zod.gen'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  FormTypeEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { ModelBar } from '../components/model-bar'
import { ToolIcon } from '../components/tool-icon'
import Node from '../node'
import Panel from '../panel'
import useConfig from '../use-config'

let mockTextGenerationModels:
  | Array<{ provider: string; models: Array<{ model: string }> }>
  | undefined = []
let mockModerationModels:
  | Array<{ provider: string; models: Array<{ model: string }> }>
  | undefined = []
let mockRerankModels: Array<{ provider: string; models: Array<{ model: string }> }> | undefined = []
let mockSpeech2TextModels:
  | Array<{ provider: string; models: Array<{ model: string }> }>
  | undefined = []
let mockTextEmbeddingModels:
  | Array<{ provider: string; models: Array<{ model: string }> }>
  | undefined = []
let mockTtsModels: Array<{ provider: string; models: Array<{ model: string }> }> | undefined = []

let mockBuiltInTools: ToolProviderListResponse | undefined = []
let mockCustomTools: ToolProviderListResponse | undefined = []
let mockWorkflowTools: ToolProviderListResponse | undefined = []
let mockMcpTools: ToolProviderListResponse | undefined = []
let mockMarketplaceIcon: string | Record<string, string> | undefined

const mockResetEditor = vi.fn()

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: ({
    value,
    models,
  }: ComponentProps<
    typeof import('@/app/components/header/account-setting/model-provider-page/model-selector').ModelSelector
  >) => (
    <div>
      {value ? `${value.provider}/${value.model}` : 'no-model'}:{models.length}
    </div>
  ),
}))

vi.mock('@/utils/get-icon', () => ({
  getIconFromMarketPlace: () => mockMarketplaceIcon,
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (value: string) => value,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/group', () => ({
  Group: ({
    label,
    children,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/group').Group
  >) => (
    <div>
      <div>{label}</div>
      {children}
    </div>
  ),
  GroupLabel: ({
    className,
    children,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/group').GroupLabel
  >) => <div className={className}>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/setting-item', () => ({
  SettingItem: ({
    label,
    status,
    tooltip,
    children,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/setting-item').SettingItem
  >) => (
    <div>
      {label}:{status}:{tooltip}:{children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/agent-strategy', () => ({
  AgentStrategy: ({
    onStrategyChange,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/agent-strategy').AgentStrategy
  >) => (
    <button
      type="button"
      onClick={() =>
        onStrategyChange({
          agent_strategy_provider_name: 'provider/updated',
          agent_strategy_name: 'updated-strategy',
          agent_strategy_label: 'Updated Strategy',
          agent_output_schema: {
            properties: { extra: { type: 'string', description: 'extra output' } },
          },
          plugin_unique_identifier: 'provider/updated:1.0.0',
          meta: { version: '2.0.0' },
        })
      }
    >
      change-strategy
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  MCPToolAvailabilityProvider: ({
    children,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/mcp-tool-availability').MCPToolAvailabilityProvider
  >) => <div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/memory-config', () => ({
  default: ({
    onChange,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/memory-config').default
  >) => (
    <button
      type="button"
      onClick={() =>
        onChange({ window: { enabled: true, size: 8 }, query_prompt_template: 'history' })
      }
    >
      change-memory
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({
    children,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/output-vars').default
  >) => <div>{children}</div>,
  VarItem: ({
    name,
    type,
    description,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/output-vars').VarItem
  >) => <div>{`${name}:${type}:${description}`}</div>,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (
    selector: (state: { setControlPromptEditorRerenderKey: typeof mockResetEditor }) => unknown,
  ) =>
    selector({
      setControlPromptEditorRerenderKey: mockResetEditor,
    }),
}))

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createStrategyParam = (
  name: string,
  type: AgentStrategyParameter['type'],
  required: boolean,
) =>
  zAgentStrategyParameter.parse({
    name,
    type,
    required,
    label: { en_US: name },
    help: { en_US: `${name} help` },
    placeholder: { en_US: `${name} placeholder` },
    scope: 'global',
    default: null,
    options: [],
    template: { enabled: false },
    auto_generate: null,
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
    modelParam: { type: VarKindType.constant, value: { provider: 'openai', model: 'gpt-4o' } },
    toolParam: { type: VarKindType.constant, value: { provider_name: 'author/tool-a' } },
    multiToolParam: { type: VarKindType.constant, value: [{ provider_name: 'author/tool-b' }] },
  },
  meta: { version: '1.0.0' },
  plugin_unique_identifier: 'provider/agent:1.0.0',
  ...overrides,
})

const createConfigResult = (
  overrides: Partial<ReturnType<typeof useConfig>> = {},
): ReturnType<typeof useConfig> => ({
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
      label: { en_US: 'React Agent' },
      provider: 'provider/agent',
    },
    parameters: [
      createStrategyParam('modelParam', FormTypeEnum.modelSelector, true),
      createStrategyParam('optionalModel', FormTypeEnum.modelSelector, false),
      createStrategyParam('multiToolParam', FormTypeEnum.multiToolSelector, false),
    ],
    description: { en_US: 'agent description' },
    output_schema: {},
    features: ['history-messages'],
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
  isChatflow: true,
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
    mockBuiltInTools = [
      createToolProviderFixture({
        name: 'author/tool-a',
        is_team_authorization: true,
        icon: 'https://example.com/icon-a.png',
      }),
    ]
    mockCustomTools = []
    mockWorkflowTools = [
      createToolProviderFixture({
        id: 'author/tool-b',
        is_team_authorization: false,
        icon: { content: 'B', background: '#fff' },
      }),
    ]
    mockMcpTools = []
    mockMarketplaceIcon = 'https://example.com/marketplace.png'
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  describe('Path Integration', () => {
    it('should render model bars for missing, installed, and missing-install models', async () => {
      const { rerender, container } = render(<ModelBar />)

      expect(container).toHaveTextContent('no-model:0')

      rerender(<ModelBar provider="openai" model="gpt-4o" />)
      await waitFor(() => expect(container).toHaveTextContent('openai/gpt-4o:1'))

      rerender(<ModelBar provider="openai" model="gpt-4.1" />)
      expect(container).toHaveTextContent('openai/gpt-4.1:1')
    })

    it('should render tool icons across loading, marketplace fallback, authorization warning, and fetch-error states', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<ToolIcon id="tool-0" providerName="author/tool-a" />)

      expect(await screen.findByRole('img', { name: 'tool icon' })).toBeInTheDocument()

      fireEvent.error(await screen.findByRole('img', { name: 'tool icon' }))
      expect(screen.queryByRole('img', { name: 'tool icon' })).not.toBeInTheDocument()

      unmount()
      const secondRender = render(<ToolIcon id="tool-1" providerName="author/tool-b" />)
      expect(await screen.findByText('B')).toBeInTheDocument()

      secondRender.unmount()
      mockBuiltInTools = undefined
      const loadingRender = render(<ToolIcon id="tool-2" providerName="author/tool-c" />)
      expect(screen.queryByRole('img', { name: 'tool icon' })).not.toBeInTheDocument()

      loadingRender.unmount()
      mockBuiltInTools = []
      render(<ToolIcon id="tool-3" providerName="market/tool-d" />)
      expect(await screen.findByRole('img', { name: 'tool icon' })).toBeInTheDocument()
      await user.unhover(await screen.findByRole('img', { name: 'tool icon' }))
    })

    it('should render strategy, models, and toolbox entries in the node', async () => {
      const { container } = render(<Node id="agent-node" data={createData()} />)

      expect(
        screen.getByText(/workflowAgent\.nodes\.agent\.strategy\.shortLabel/),
      ).toBeInTheDocument()
      expect(container).toHaveTextContent('React Agent')
      expect(screen.getByText('workflowAgent.nodes.agent.model')).toBeInTheDocument()
      expect(screen.getByText('workflowAgent.nodes.agent.toolbox')).toBeInTheDocument()
      await waitFor(() => expect(container).toHaveTextContent('openai/gpt-4o:1'))
    })

    it('should render the panel, update the selected strategy, and expose memory plus output vars', async () => {
      const user = userEvent.setup()
      const config = createConfigResult()
      mockUseConfig.mockReturnValue(config)

      render(<Panel id="agent-node" data={createData()} panelProps={panelProps} />)

      expect(screen.getByText('workflowAgent.nodes.agent.strategy.label')).toBeInTheDocument()
      expect(
        screen.getByText('text:String:workflow.nodes.agent.outputVars.text'),
      ).toBeInTheDocument()
      expect(screen.getByText('jsonField:String:json output')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'change-strategy' }))
      expect(config.setInputs).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_strategy_provider_name: 'provider/updated',
          agent_strategy_name: 'updated-strategy',
          agent_strategy_label: 'Updated Strategy',
          plugin_unique_identifier: 'provider/updated:1.0.0',
        }),
      )
      expect(mockResetEditor).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'change-memory' }))
      expect(config.handleMemoryChange).toHaveBeenCalledWith({
        window: { enabled: true, size: 8 },
        query_prompt_template: 'history',
      })
    })
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.models.modelTypes.byModelType.get': async (input: {
        params: GetWorkspacesCurrentModelsModelTypesByModelTypeData['path']
      }) => {
        const lists = {
          [ModelTypeEnum.textGeneration]: mockTextGenerationModels,
          [ModelTypeEnum.moderation]: mockModerationModels,
          [ModelTypeEnum.rerank]: mockRerankModels,
          [ModelTypeEnum.speech2text]: mockSpeech2TextModels,
          [ModelTypeEnum.textEmbedding]: mockTextEmbeddingModels,
          [ModelTypeEnum.tts]: mockTtsModels,
        }
        return { data: lists[input.params.model_type as keyof typeof lists] ?? [] }
      },
      'workspaces.current.tools.builtin.get': async () => mockBuiltInTools ?? new Promise(() => {}),
      'workspaces.current.tools.api.get': async () => mockCustomTools ?? new Promise(() => {}),
      'workspaces.current.tools.workflow.get': async () =>
        mockWorkflowTools ?? new Promise(() => {}),
      'workspaces.current.tools.mcp.get': async () => mockMcpTools ?? new Promise(() => {}),
    }),
  }
})
