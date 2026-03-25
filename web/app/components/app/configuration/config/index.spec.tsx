import type { Mock } from 'vitest'
import type { ModelConfig, PromptVariable } from '@/models/debug'
import type { ToolItem } from '@/types/app'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import * as useContextSelector from 'use-context-selector'
import { AgentStrategy, AppModeEnum, ModelModeType } from '@/types/app'
import Config from './index'

vi.mock('use-context-selector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('use-context-selector')>()
  return {
    ...actual,
    useContext: vi.fn(),
  }
})

const mockFormattingDispatcher = vi.fn()
vi.mock('../debug/hooks', () => ({
  useFormattingChangedDispatcher: () => mockFormattingDispatcher,
}))

let latestConfigPromptProps: any
vi.mock('@/app/components/app/configuration/config-prompt', () => ({
  default: (props: any) => {
    latestConfigPromptProps = props
    return <div data-testid="config-prompt" />
  },
}))

let latestConfigVarProps: any
vi.mock('@/app/components/app/configuration/config-var', () => ({
  default: (props: any) => {
    latestConfigVarProps = props
    return <div data-testid="config-var" />
  },
}))

vi.mock('../dataset-config', () => ({
  default: () => <div data-testid="dataset-config" />,
}))

vi.mock('./agent/agent-tools', () => ({
  default: () => <div data-testid="agent-tools" />,
}))

vi.mock('../config-vision', () => ({
  default: () => <div data-testid="config-vision" />,
}))

vi.mock('./config-document', () => ({
  default: () => <div data-testid="config-document" />,
}))

vi.mock('./config-audio', () => ({
  default: () => <div data-testid="config-audio" />,
}))

let latestHistoryPanelProps: any
vi.mock('../config-prompt/conversation-history/history-panel', () => ({
  default: (props: any) => {
    latestHistoryPanelProps = props
    return <div data-testid="history-panel" />
  },
}))

type MockContext = {
  mode: AppModeEnum
  isAdvancedMode: boolean
  modelModeType: ModelModeType
  isAgent: boolean
  hasSetBlockStatus: {
    context: boolean
    history: boolean
    query: boolean
  }
  showHistoryModal: Mock
  modelConfig: ModelConfig
  setModelConfig: Mock
  setPrevPromptConfig: Mock
}

const createPromptVariable = (overrides: Partial<PromptVariable> = {}): PromptVariable => ({
  key: 'variable',
  name: 'Variable',
  type: 'string',
  ...overrides,
})

const createModelConfig = (overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  provider: 'openai',
  model_id: 'gpt-4',
  mode: ModelModeType.chat,
  configs: {
    prompt_template: 'Hello {{variable}}',
    prompt_variables: [createPromptVariable({ key: 'existing' })],
  },
  chat_prompt_config: null,
  completion_prompt_config: null,
  opening_statement: null,
  more_like_this: null,
  suggested_questions: null,
  suggested_questions_after_answer: null,
  speech_to_text: null,
  text_to_speech: null,
  file_upload: null,
  retriever_resource: null,
  sensitive_word_avoidance: null,
  annotation_reply: null,
  external_data_tools: null,
  system_parameters: {
    audio_file_size_limit: 1,
    file_size_limit: 1,
    image_file_size_limit: 1,
    video_file_size_limit: 1,
    workflow_file_upload_limit: 1,
  },
  dataSets: [],
  agentConfig: {
    enabled: false,
    strategy: AgentStrategy.react,
    max_iteration: 1,
    tools: [] as ToolItem[],
  },
  ...overrides,
})

const createContextValue = (overrides: Partial<MockContext> = {}): MockContext => ({
  mode: AppModeEnum.CHAT,
  isAdvancedMode: false,
  modelModeType: ModelModeType.chat,
  isAgent: false,
  hasSetBlockStatus: {
    context: false,
    history: true,
    query: false,
  },
  showHistoryModal: vi.fn(),
  modelConfig: createModelConfig(),
  setModelConfig: vi.fn(),
  setPrevPromptConfig: vi.fn(),
  ...overrides,
})

const mockUseContext = useContextSelector.useContext as Mock

const renderConfig = (contextOverrides: Partial<MockContext> = {}) => {
  const contextValue = createContextValue(contextOverrides)
  mockUseContext.mockReturnValue(contextValue)
  return {
    contextValue,
    ...render(<Config />),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  latestConfigPromptProps = undefined
  latestConfigVarProps = undefined
  latestHistoryPanelProps = undefined
})

// Rendering scenarios ensure the layout toggles agent/history specific sections correctly.
describe('Config - Rendering', () => {
  it('should render baseline sections without agent specific panels', () => {
    renderConfig()

    expect(screen.getByTestId('config-prompt')).toBeInTheDocument()
    expect(screen.getByTestId('config-var')).toBeInTheDocument()
    expect(screen.getByTestId('dataset-config')).toBeInTheDocument()
    expect(screen.getByTestId('config-vision')).toBeInTheDocument()
    expect(screen.getByTestId('config-document')).toBeInTheDocument()
    expect(screen.getByTestId('config-audio')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-tools')).not.toBeInTheDocument()
    expect(screen.queryByTestId('history-panel')).not.toBeInTheDocument()
  })

  it('should show AgentTools when app runs in agent mode', () => {
    renderConfig({ isAgent: true })

    expect(screen.getByTestId('agent-tools')).toBeInTheDocument()
  })

  it('should display HistoryPanel only when advanced chat completion values apply', () => {
    const showHistoryModal = vi.fn()
    renderConfig({
      isAdvancedMode: true,
      mode: AppModeEnum.ADVANCED_CHAT,
      modelModeType: ModelModeType.completion,
      hasSetBlockStatus: {
        context: false,
        history: false,
        query: false,
      },
      showHistoryModal,
    })

    expect(screen.getByTestId('history-panel')).toBeInTheDocument()
    expect(latestHistoryPanelProps.showWarning).toBe(true)
    expect(latestHistoryPanelProps.onShowEditModal).toBe(showHistoryModal)
  })
})

// Prompt handling scenarios validate integration between Config and prompt children.
describe('Config - Prompt Handling', () => {
  it('should update prompt template and dispatch formatting event when text changes', () => {
    const { contextValue } = renderConfig()
    const previousVariables = contextValue.modelConfig.configs.prompt_variables
    const additions = [createPromptVariable({ key: 'new', name: 'New' })]

    latestConfigPromptProps.onChange('Updated template', additions)

    expect(contextValue.setPrevPromptConfig).toHaveBeenCalledWith(contextValue.modelConfig.configs)
    expect(contextValue.setModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      configs: expect.objectContaining({
        prompt_template: 'Updated template',
        prompt_variables: [...previousVariables, ...additions],
      }),
    }))
    expect(mockFormattingDispatcher).toHaveBeenCalledTimes(1)
  })

  it('should skip formatting dispatcher when template remains identical', () => {
    const { contextValue } = renderConfig()
    const unchangedTemplate = contextValue.modelConfig.configs.prompt_template

    latestConfigPromptProps.onChange(unchangedTemplate, [createPromptVariable({ key: 'added' })])

    expect(contextValue.setPrevPromptConfig).toHaveBeenCalledWith(contextValue.modelConfig.configs)
    expect(mockFormattingDispatcher).not.toHaveBeenCalled()
  })

  it('should replace prompt variables when ConfigVar reports updates', () => {
    const { contextValue } = renderConfig()
    const replacementVariables = [createPromptVariable({ key: 'replacement' })]

    latestConfigVarProps.onPromptVariablesChange(replacementVariables)

    expect(contextValue.setPrevPromptConfig).toHaveBeenCalledWith(contextValue.modelConfig.configs)
    expect(contextValue.setModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      configs: expect.objectContaining({
        prompt_variables: replacementVariables,
      }),
    }))
  })
})
