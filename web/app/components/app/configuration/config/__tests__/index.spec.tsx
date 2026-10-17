import type { ComponentProps } from 'react'
import type { ConfigurationAppMode } from '@/app/components/app/configuration/hooks/configuration-lifecycle/types'
import type { ModelConfig, PromptVariable } from '@/models/debug'
import type { ToolItem } from '@/types/app'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { renderWithDebugConfiguration } from '@/test/debug-configuration'
import { AgentStrategy, ModelModeType } from '@/types/app'
import Config from '../index'

let configuration: Parameters<typeof renderWithDebugConfiguration>[1] = {}
const render = (ui: Parameters<typeof renderWithDebugConfiguration>[0]) =>
  renderWithDebugConfiguration(ui, configuration)

const mockFormattingDispatcher = vi.fn()
vi.mock('../../debug/hooks', () => ({
  useFormattingChangedDispatcher: () => mockFormattingDispatcher,
}))

vi.mock('@/app/components/app/configuration/config-prompt', () => ({
  default: (
    props: ComponentProps<
      typeof import('@/app/components/app/configuration/config-prompt').default
    >,
  ) => (
    <>
      <textarea
        aria-label="Prompt draft"
        defaultValue={props.promptTemplate}
        onChange={(event) =>
          props.onChange?.(event.target.value, [{ key: 'new', name: 'New', type: 'string' }])
        }
      />
      <button
        type="button"
        onClick={() =>
          props.onChange?.(props.promptTemplate, [{ key: 'added', name: 'Added', type: 'string' }])
        }
      >
        Add prompt variable
      </button>
    </>
  ),
}))
vi.mock('@/app/components/app/configuration/config-var', () => ({
  default: (
    props: ComponentProps<typeof import('@/app/components/app/configuration/config-var').default>,
  ) => (
    <button
      type="button"
      onClick={() =>
        props.onPromptVariablesChange?.([{ key: 'replacement', name: 'Variable', type: 'string' }])
      }
    >
      Replace variables
    </button>
  ),
}))

vi.mock('../../dataset-config', () => ({
  default: () => <div data-testid="dataset-config" />,
}))

vi.mock('../agent/agent-tools', () => ({
  default: () => <div data-testid="agent-tools" />,
}))

vi.mock('../../config-vision', () => ({
  default: () => <div data-testid="config-vision" />,
}))

vi.mock('../config-document', () => ({
  default: () => <div data-testid="config-document" />,
}))

vi.mock('../config-audio', () => ({
  default: () => <div data-testid="config-audio" />,
}))

type MockContext = {
  mode: ConfigurationAppMode
  isAdvancedMode: boolean
  modelModeType: ModelModeType
  isAgent: boolean
  hasSetBlockStatus: {
    context: boolean
    history: boolean
    query: boolean
  }
  showHistoryModal: () => void
  modelConfig: ModelConfig
  setModelConfig: (modelConfig: ModelConfig) => void
  setPrevPromptConfig: (configs: ModelConfig['configs']) => void
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
  mode: 'chat' as const,
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

const renderConfig = (contextOverrides: Partial<MockContext> = {}) => {
  const contextValue = createContextValue(contextOverrides)
  configuration = contextValue
  return {
    contextValue,
    ...render(<Config />),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Rendering scenarios ensure the layout toggles agent/history specific sections correctly.
describe('Config - Rendering', () => {
  it('should render baseline sections without agent specific panels', () => {
    renderConfig()

    expect(screen.getByRole('textbox', { name: 'Prompt draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace variables' })).toBeInTheDocument()
    expect(screen.getByTestId('dataset-config')).toBeInTheDocument()
    expect(screen.getByTestId('config-vision')).toBeInTheDocument()
    expect(screen.getByTestId('config-document')).toBeInTheDocument()
    expect(screen.getByTestId('config-audio')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-tools')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'appDebug.feature.conversationHistory.title' }),
    ).not.toBeInTheDocument()
  })

  it('should show AgentTools when app runs in agent mode', () => {
    renderConfig({ isAgent: true })

    expect(screen.getByTestId('agent-tools')).toBeInTheDocument()
  })

  it('should display HistoryPanel for a chat app using an advanced completion prompt', async () => {
    const user = userEvent.setup()
    const showHistoryModal = vi.fn()
    renderConfig({
      isAdvancedMode: true,
      mode: 'chat' as const,
      modelModeType: ModelModeType.completion,
      hasSetBlockStatus: {
        context: false,
        history: false,
        query: false,
      },
      showHistoryModal,
    })

    expect(screen.getByText('appDebug.feature.conversationHistory.tip')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(showHistoryModal).toHaveBeenCalledTimes(1)
  })
})

// Prompt handling scenarios validate integration between Config and prompt children.
describe('Config - Prompt Handling', () => {
  it('should update prompt template and dispatch formatting event when text changes', async () => {
    const user = userEvent.setup()
    const { contextValue } = renderConfig()
    const previousVariables = contextValue.modelConfig.configs.prompt_variables
    const additions = [createPromptVariable({ key: 'new', name: 'New' })]

    const prompt = screen.getByRole('textbox', { name: 'Prompt draft' })
    await user.clear(prompt)
    await user.paste('Updated template')

    expect(contextValue.setPrevPromptConfig).toHaveBeenCalledWith(contextValue.modelConfig.configs)
    expect(contextValue.setModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        configs: expect.objectContaining({
          prompt_template: 'Updated template',
          prompt_variables: [...previousVariables, ...additions],
        }),
      }),
    )
    expect(mockFormattingDispatcher).toHaveBeenCalledTimes(2)
  })

  it('should skip formatting dispatcher when template remains identical', async () => {
    const user = userEvent.setup()
    const { contextValue } = renderConfig()

    await user.click(screen.getByRole('button', { name: 'Add prompt variable' }))

    expect(contextValue.setPrevPromptConfig).toHaveBeenCalledWith(contextValue.modelConfig.configs)
    expect(mockFormattingDispatcher).not.toHaveBeenCalled()
  })

  it('should replace prompt variables when ConfigVar reports updates', async () => {
    const user = userEvent.setup()
    const { contextValue } = renderConfig()
    const replacementVariables = [createPromptVariable({ key: 'replacement' })]

    await user.click(screen.getByRole('button', { name: 'Replace variables' }))

    expect(contextValue.setPrevPromptConfig).toHaveBeenCalledWith(contextValue.modelConfig.configs)
    expect(contextValue.setModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        configs: expect.objectContaining({
          prompt_variables: replacementVariables,
        }),
      }),
    )
  })
})
