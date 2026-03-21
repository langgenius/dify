import type {
  PropsWithChildren,
} from 'react'
import type { Mock } from 'vitest'
import type SettingBuiltInToolType from './setting-built-in-tool'
import type { Tool, ToolParameter } from '@/app/components/tools/types'
import type ToolPickerType from '@/app/components/workflow/block-selector/tool-picker'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { ModelConfig } from '@/models/debug'
import type { AgentTool } from '@/types/app'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import {
  useEffect,
  useMemo,
  useState,
} from 'react'
import { CollectionType } from '@/app/components/tools/types'
import {
  DEFAULT_AGENT_SETTING,
  DEFAULT_CHAT_PROMPT_CONFIG,
  DEFAULT_COMPLETION_PROMPT_CONFIG,
} from '@/config'
import ConfigContext from '@/context/debug-configuration'
import { ModelModeType } from '@/types/app'
import AgentTools from './index'

const formattingDispatcherMock = vi.fn()
vi.mock('@/app/components/app/configuration/debug/hooks', () => ({
  useFormattingChangedDispatcher: () => formattingDispatcherMock,
}))

let pluginInstallHandler: ((names: string[]) => void) | null = null
const subscribeMock = vi.fn((event: string, handler: any) => {
  if (event === 'plugin:install:success')
    pluginInstallHandler = handler
})
vi.mock('@/context/mitt-context', () => ({
  useMittContextSelector: (selector: any) => selector({
    useSubscribe: subscribeMock,
  }),
}))

let builtInTools: ToolWithProvider[] = []
let customTools: ToolWithProvider[] = []
let workflowTools: ToolWithProvider[] = []
let mcpTools: ToolWithProvider[] = []
vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: builtInTools }),
  useAllCustomTools: () => ({ data: customTools }),
  useAllWorkflowTools: () => ({ data: workflowTools }),
  useAllMCPTools: () => ({ data: mcpTools }),
}))

type ToolPickerProps = React.ComponentProps<typeof ToolPickerType>
let singleToolSelection: ToolDefaultValue | null = null
let multipleToolSelection: ToolDefaultValue[] = []
const ToolPickerMock = (props: ToolPickerProps) => (
  <div data-testid="tool-picker">
    <div>{props.trigger}</div>
    <button
      type="button"
      onClick={() => singleToolSelection && props.onSelect(singleToolSelection)}
    >
      pick-single
    </button>
    <button
      type="button"
      onClick={() => props.onSelectMultiple(multipleToolSelection)}
    >
      pick-multiple
    </button>
  </div>
)
vi.mock('@/app/components/workflow/block-selector/tool-picker', () => ({
  default: (props: ToolPickerProps) => <ToolPickerMock {...props} />,
}))

type SettingBuiltInToolProps = React.ComponentProps<typeof SettingBuiltInToolType>
let latestSettingPanelProps: SettingBuiltInToolProps | null = null
let settingPanelSavePayload: Record<string, any> = {}
let settingPanelCredentialId = 'credential-from-panel'
const SettingBuiltInToolMock = (props: SettingBuiltInToolProps) => {
  latestSettingPanelProps = props
  return (
    <div data-testid="setting-built-in-tool">
      <span>{props.toolName}</span>
      <button type="button" onClick={() => props.onSave?.(settingPanelSavePayload)}>save-from-panel</button>
      <button type="button" onClick={() => props.onAuthorizationItemClick?.(settingPanelCredentialId)}>auth-from-panel</button>
      <button type="button" onClick={props.onHide}>close-panel</button>
    </div>
  )
}
vi.mock('./setting-built-in-tool', () => ({
  default: (props: SettingBuiltInToolProps) => <SettingBuiltInToolMock {...props} />,
}))

vi.mock('copy-to-clipboard')

const copyMock = copy as Mock

const createToolParameter = (overrides?: Partial<ToolParameter>): ToolParameter => ({
  name: 'api_key',
  label: {
    en_US: 'API Key',
    zh_Hans: 'API Key',
  },
  human_description: {
    en_US: 'desc',
    zh_Hans: 'desc',
  },
  type: 'string',
  form: 'config',
  llm_description: '',
  required: true,
  multiple: false,
  default: 'default',
  ...overrides,
})

const createToolDefinition = (overrides?: Partial<Tool>): Tool => ({
  name: 'search',
  author: 'tester',
  label: {
    en_US: 'Search',
    zh_Hans: 'Search',
  },
  description: {
    en_US: 'desc',
    zh_Hans: 'desc',
  },
  parameters: [createToolParameter()],
  labels: [],
  output_schema: {},
  ...overrides,
})

const createCollection = (overrides?: Partial<ToolWithProvider>): ToolWithProvider => ({
  id: overrides?.id || 'provider-1',
  name: overrides?.name || 'vendor/provider-1',
  author: 'tester',
  description: {
    en_US: 'desc',
    zh_Hans: 'desc',
  },
  icon: 'https://example.com/icon.png',
  label: {
    en_US: 'Provider Label',
    zh_Hans: 'Provider Label',
  },
  type: overrides?.type || CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: true,
  labels: [],
  tools: overrides?.tools || [createToolDefinition()],
  meta: {
    version: '1.0.0',
  },
  ...overrides,
})

const createAgentTool = (overrides?: Partial<AgentTool>): AgentTool => ({
  provider_id: overrides?.provider_id || 'provider-1',
  provider_type: overrides?.provider_type || CollectionType.builtIn,
  provider_name: overrides?.provider_name || 'vendor/provider-1',
  tool_name: overrides?.tool_name || 'search',
  tool_label: overrides?.tool_label || 'Search Tool',
  tool_parameters: overrides?.tool_parameters || { api_key: 'key' },
  enabled: overrides?.enabled ?? true,
  ...overrides,
})

const createModelConfig = (tools: AgentTool[]): ModelConfig => ({
  provider: 'OPENAI',
  model_id: 'gpt-3.5-turbo',
  mode: ModelModeType.chat,
  configs: {
    prompt_template: '',
    prompt_variables: [],
  },
  chat_prompt_config: DEFAULT_CHAT_PROMPT_CONFIG,
  completion_prompt_config: DEFAULT_COMPLETION_PROMPT_CONFIG,
  opening_statement: '',
  more_like_this: null,
  suggested_questions: [],
  suggested_questions_after_answer: null,
  speech_to_text: null,
  text_to_speech: null,
  file_upload: null,
  retriever_resource: null,
  sensitive_word_avoidance: null,
  annotation_reply: null,
  external_data_tools: [],
  system_parameters: {
    audio_file_size_limit: 0,
    file_size_limit: 0,
    image_file_size_limit: 0,
    video_file_size_limit: 0,
    workflow_file_upload_limit: 0,
  },
  dataSets: [],
  agentConfig: {
    ...DEFAULT_AGENT_SETTING,
    tools,
  },
})

const renderAgentTools = (initialTools?: AgentTool[]) => {
  const tools = initialTools ?? [createAgentTool()]
  const modelConfigRef = { current: createModelConfig(tools) }
  const Wrapper = ({ children }: PropsWithChildren) => {
    const [modelConfig, setModelConfig] = useState<ModelConfig>(modelConfigRef.current)
    useEffect(() => {
      modelConfigRef.current = modelConfig
    }, [modelConfig])
    const value = useMemo(() => ({
      modelConfig,
      setModelConfig,
    }), [modelConfig])
    return (
      <ConfigContext.Provider value={value as any}>
        {children}
      </ConfigContext.Provider>
    )
  }
  const renderResult = render(
    <Wrapper>
      <AgentTools />
    </Wrapper>,
  )
  return {
    ...renderResult,
    getModelConfig: () => modelConfigRef.current,
  }
}

const hoverInfoIcon = async (rowIndex = 0) => {
  const rows = document.querySelectorAll('.group')
  const infoTrigger = rows.item(rowIndex)?.querySelector('[data-testid="tool-info-tooltip"]')
  if (!infoTrigger)
    throw new Error('Info trigger not found')
  await userEvent.hover(infoTrigger as HTMLElement)
}

describe('AgentTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    builtInTools = [
      createCollection(),
      createCollection({
        id: 'provider-2',
        name: 'vendor/provider-2',
        tools: [createToolDefinition({
          name: 'translate',
          label: {
            en_US: 'Translate',
            zh_Hans: 'Translate',
          },
        })],
      }),
      createCollection({
        id: 'provider-3',
        name: 'vendor/provider-3',
        tools: [createToolDefinition({
          name: 'summarize',
          label: {
            en_US: 'Summary',
            zh_Hans: 'Summary',
          },
        })],
      }),
    ]
    customTools = []
    workflowTools = []
    mcpTools = []
    singleToolSelection = {
      provider_id: 'provider-3',
      provider_type: CollectionType.builtIn,
      provider_name: 'vendor/provider-3',
      tool_name: 'summarize',
      tool_label: 'Summary Tool',
      tool_description: 'desc',
      title: 'Summary Tool',
      is_team_authorization: true,
      params: { api_key: 'picker-value' },
      paramSchemas: [],
      output_schema: {},
    }
    multipleToolSelection = [
      {
        provider_id: 'provider-2',
        provider_type: CollectionType.builtIn,
        provider_name: 'vendor/provider-2',
        tool_name: 'translate',
        tool_label: 'Translate Tool',
        tool_description: 'desc',
        title: 'Translate Tool',
        is_team_authorization: true,
        params: { api_key: 'multi-a' },
        paramSchemas: [],
        output_schema: {},
      },
      {
        provider_id: 'provider-3',
        provider_type: CollectionType.builtIn,
        provider_name: 'vendor/provider-3',
        tool_name: 'summarize',
        tool_label: 'Summary Tool',
        tool_description: 'desc',
        title: 'Summary Tool',
        is_team_authorization: true,
        params: { api_key: 'multi-b' },
        paramSchemas: [],
        output_schema: {},
      },
    ]
    latestSettingPanelProps = null
    settingPanelSavePayload = {}
    settingPanelCredentialId = 'credential-from-panel'
    pluginInstallHandler = null
  })

  it('should show enabled count and provider information', () => {
    renderAgentTools([
      createAgentTool(),
      createAgentTool({
        provider_id: 'provider-2',
        provider_name: 'vendor/provider-2',
        tool_name: 'translate',
        tool_label: 'Translate Tool',
        enabled: false,
      }),
    ])

    const enabledText = screen.getByText(content => content.includes('appDebug.agent.tools.enabled'))
    expect(enabledText).toHaveTextContent('1/2')
    expect(screen.getByText('provider-1')).toBeInTheDocument()
    expect(screen.getByText('Translate Tool')).toBeInTheDocument()
  })

  it('should copy tool name from tooltip action', async () => {
    renderAgentTools()

    await hoverInfoIcon()
    const copyButton = await screen.findByText('tools.copyToolName')
    await userEvent.click(copyButton)
    expect(copyMock).toHaveBeenCalledWith('search')
  })

  it('should toggle tool enabled state via switch', async () => {
    const { getModelConfig } = renderAgentTools()

    const switchButton = screen.getByRole('switch')
    await userEvent.click(switchButton)

    await waitFor(() => {
      const tools = getModelConfig().agentConfig.tools as Array<{ tool_name?: string, enabled?: boolean }>
      const toggledTool = tools.find(tool => tool.tool_name === 'search')
      expect(toggledTool?.enabled).toBe(false)
    })
    expect(formattingDispatcherMock).toHaveBeenCalled()
  })

  it('should remove tool when delete action is clicked', async () => {
    const { getModelConfig } = renderAgentTools()
    const deleteButton = screen.getByTestId('delete-removed-tool')
    if (!deleteButton)
      throw new Error('Delete button not found')
    await userEvent.click(deleteButton)
    await waitFor(() => {
      expect(getModelConfig().agentConfig.tools).toHaveLength(0)
    })
    expect(formattingDispatcherMock).toHaveBeenCalled()
  })

  it('should add a tool when ToolPicker selects one', async () => {
    const { getModelConfig } = renderAgentTools([])
    const addSingleButton = screen.getByRole('button', { name: 'pick-single' })
    await userEvent.click(addSingleButton)

    await waitFor(() => {
      expect(screen.getByText('Summary Tool')).toBeInTheDocument()
    })
    expect(getModelConfig().agentConfig.tools).toHaveLength(1)
  })

  it('should append multiple selected tools at once', async () => {
    const { getModelConfig } = renderAgentTools([])
    await userEvent.click(screen.getByRole('button', { name: 'pick-multiple' }))

    await waitFor(() => {
      expect(screen.getByText('Translate Tool')).toBeInTheDocument()
      expect(screen.getAllByText('Summary Tool')).toHaveLength(1)
    })
    expect(getModelConfig().agentConfig.tools).toHaveLength(2)
  })

  it('should open settings panel for not authorized tool', async () => {
    renderAgentTools([
      createAgentTool({
        notAuthor: true,
      }),
    ])

    const notAuthorizedButton = screen.getByRole('button', { name: /tools.notAuthorized/ })
    await userEvent.click(notAuthorizedButton)
    expect(screen.getByTestId('setting-built-in-tool')).toBeInTheDocument()
    expect(latestSettingPanelProps?.toolName).toBe('search')
  })

  it('should persist tool parameters when SettingBuiltInTool saves values', async () => {
    const { getModelConfig } = renderAgentTools([
      createAgentTool({
        notAuthor: true,
      }),
    ])
    await userEvent.click(screen.getByRole('button', { name: /tools.notAuthorized/ }))
    settingPanelSavePayload = { api_key: 'updated' }
    await userEvent.click(screen.getByRole('button', { name: 'save-from-panel' }))

    await waitFor(() => {
      expect((getModelConfig().agentConfig.tools[0] as { tool_parameters: Record<string, any> }).tool_parameters).toEqual({ api_key: 'updated' })
    })
  })

  it('should update credential id when authorization selection changes', async () => {
    const { getModelConfig } = renderAgentTools([
      createAgentTool({
        notAuthor: true,
      }),
    ])
    await userEvent.click(screen.getByRole('button', { name: /tools.notAuthorized/ }))
    settingPanelCredentialId = 'credential-123'
    await userEvent.click(screen.getByRole('button', { name: 'auth-from-panel' }))

    await waitFor(() => {
      expect((getModelConfig().agentConfig.tools[0] as { credential_id: string }).credential_id).toBe('credential-123')
    })
    expect(formattingDispatcherMock).toHaveBeenCalled()
  })

  it('should reinstate deleted tools after plugin install success event', async () => {
    const { getModelConfig } = renderAgentTools([
      createAgentTool({
        provider_id: 'provider-1',
        provider_name: 'vendor/provider-1',
        tool_name: 'search',
        tool_label: 'Search Tool',
        isDeleted: true,
      }),
    ])
    if (!pluginInstallHandler)
      throw new Error('Plugin handler not registered')

    await act(async () => {
      pluginInstallHandler?.(['provider-1'])
    })

    await waitFor(() => {
      expect((getModelConfig().agentConfig.tools[0] as { isDeleted: boolean }).isDeleted).toBe(false)
    })
  })
})
