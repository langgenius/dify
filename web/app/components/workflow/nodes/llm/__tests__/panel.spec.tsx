import type { LLMNodeType } from '../types'
import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelParameterModalProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import type { PanelProps } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ProviderContext } from '@/context/provider-context'
import { AppModeEnum } from '@/types/app'
import { FlowType } from '@/types/common'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'
import { BlockEnum } from '../../../types'
import Panel from '../panel'

const mockUseConfig = vi.fn()
const mockFetchAndMergeValidCompletionParams = vi.mocked(fetchAndMergeValidCompletionParams)

vi.mock('../use-config', () => ({
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('@/utils/completion-params', () => ({
  fetchAndMergeValidCompletionParams: vi.fn().mockResolvedValue({
    params: {},
    removedDetails: {},
  }),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: ({ modelSelectorReadonly, readonly, setModel }: ModelParameterModalProps) => (
      <div>
        <div
          data-testid="model-parameter-modal"
          data-model-selector-readonly={modelSelectorReadonly}
          data-readonly={readonly}
        />
        <button
          type="button"
          onClick={() => setModel({ provider: 'anthropic', modelId: 'claude-3-5-sonnet' })}
        >
          Select direct model
        </button>
      </div>
    ),
  }),
)

vi.mock('../_base/components/config-vision', () => ({
  default: () => null,
}))

vi.mock('../../_base/components/variable/var-reference-picker', () => ({
  default: () => null,
}))

vi.mock('../components/config-prompt', () => ({
  default: () => null,
}))

vi.mock('../components/panel-memory-section', () => ({
  default: () => null,
}))

vi.mock('../components/panel-output-section', () => ({
  default: () => null,
}))

vi.mock('../components/reasoning-format-config', () => ({
  default: () => null,
}))

type MockUseConfigReturn = ReturnType<typeof mockUseConfig>

const createMockModelProvider = (provider: string): ModelProvider => ({
  provider,
  label: { en_US: provider, zh_Hans: provider },
  help: {
    title: { en_US: provider, zh_Hans: provider },
    url: { en_US: '', zh_Hans: '' },
  },
  icon_small: { en_US: '', zh_Hans: '' },
  supported_model_types: [ModelTypeEnum.textGeneration],
  configurate_methods: [ConfigurationMethodEnum.predefinedModel],
  provider_credential_schema: {
    credential_form_schemas: [],
  },
  model_credential_schema: {
    model: {
      label: { en_US: '', zh_Hans: '' },
      placeholder: { en_US: '', zh_Hans: '' },
    },
    credential_form_schemas: [],
  },
  preferred_provider_type: PreferredProviderTypeEnum.system,
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
  },
  system_configuration: {
    enabled: true,
    current_quota_type: CurrentSystemQuotaTypeEnum.free,
    quota_configurations: [],
  },
})

const baseNodeData: LLMNodeType = {
  type: BlockEnum.LLM,
  title: 'LLM',
  desc: '',
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  },
  prompt_template: [],
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
}

const panelProps = {} as PanelProps

const buildUseConfigResult = (overrides?: Partial<MockUseConfigReturn>) => ({
  readOnly: false,
  inputs: baseNodeData,
  model: baseNodeData.model,
  environmentVariables: [],
  isEnvironmentModelSource: false,
  isChatModel: true,
  isChatMode: true,
  isCompletionModel: false,
  shouldShowContextTip: false,
  isVisionModel: false,
  handleModelChanged: vi.fn(),
  handleModelSourceChange: vi.fn(),
  handleModelSelectorChange: vi.fn(),
  hasSetBlockStatus: false,
  handleCompletionParamsChange: vi.fn(),
  handleContextVarChange: vi.fn(),
  filterInputVar: vi.fn(),
  filterVar: vi.fn(),
  availableVars: [],
  availableNodesWithParent: [],
  isShowVars: false,
  handlePromptChange: vi.fn(),
  handleAddEmptyVariable: vi.fn(),
  handleAddVariable: vi.fn(),
  handleVarListChange: vi.fn(),
  handleVarNameChange: vi.fn(),
  handleSyeQueryChange: vi.fn(),
  handleMemoryChange: vi.fn(),
  handleVisionResolutionEnabledChange: vi.fn(),
  handleVisionResolutionChange: vi.fn(),
  isModelSupportStructuredOutput: false,
  structuredOutputCollapsed: false,
  setStructuredOutputCollapsed: vi.fn(),
  handleStructureOutputEnableChange: vi.fn(),
  handleStructureOutputChange: vi.fn(),
  filterJinja2InputVar: vi.fn(),
  handleReasoningFormatChange: vi.fn(),
  ...overrides,
})

const renderPanelElement = (data?: Partial<LLMNodeType>) => (
  // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its special provider.
  <ProviderContext.Provider
    value={createMockProviderContextValue({
      modelProviders: [createMockModelProvider('openai')],
      isFetchedPlan: true,
    })}
  >
    <Panel id="llm-node" data={{ ...baseNodeData, ...data }} panelProps={panelProps} />
  </ProviderContext.Provider>
)

const renderPanel = (data?: Partial<LLMNodeType>, flowType?: FlowType) => {
  return renderWorkflowFlowComponent(renderPanelElement(data), {
    hooksStoreProps: flowType
      ? { configsMap: { flowId: 'test-flow', flowType, fileSettings: {} } }
      : {},
  })
}

describe('LLM Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(buildUseConfigResult())
  })

  describe('Model Warning Dot', () => {
    it('should not show the model warning dot when the node only has a connection checklist issue', () => {
      renderPanel()

      const modelField = screen.getByText('workflow.nodes.llm.model').parentElement
      expect(modelField?.querySelector('.bg-text-warning-secondary')).not.toBeInTheDocument()
    })

    it('should show the model warning dot when the model is not configured', () => {
      mockUseConfig.mockReturnValue(
        buildUseConfigResult({
          model: {
            ...baseNodeData.model,
            provider: '',
            name: '',
          },
          inputs: {
            ...baseNodeData,
            model: {
              ...baseNodeData.model,
              provider: '',
              name: '',
            },
          },
        }),
      )

      renderPanel({
        model: {
          ...baseNodeData.model,
          provider: '',
          name: '',
        },
      })

      const modelField = screen.getByText('workflow.nodes.llm.model').parentElement
      expect(modelField?.querySelector('.bg-text-warning-secondary')).toBeInTheDocument()
    })
  })

  it('switches from direct model input to an environment reference source', async () => {
    const user = userEvent.setup()
    const handleModelSourceChange = vi.fn()
    mockUseConfig.mockReturnValue(buildUseConfigResult({ handleModelSourceChange }))

    renderPanel()

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.common.typeSwitch.variable' }),
    )
    expect(handleModelSourceChange).toHaveBeenCalledWith(true)
  })

  it('does not offer an environment model source in snippet flows', () => {
    renderPanel(undefined, FlowType.snippet)

    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.common.typeSwitch.variable' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.common.typeSwitch.input' }),
    ).not.toBeInTheDocument()
  })

  it('allows a pasted environment-bound snippet node to recover to a direct model', async () => {
    const user = userEvent.setup()
    const handleModelSourceChange = vi.fn()
    mockUseConfig.mockReturnValue(
      buildUseConfigResult({
        inputs: { ...baseNodeData, model_selector: ['env', 'shared_model'] },
        isEnvironmentModelSource: true,
        handleModelSourceChange,
      }),
    )

    renderPanel({ model_selector: ['env', 'shared_model'] }, FlowType.snippet)
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.typeSwitch.input' }))

    expect(handleModelSourceChange).toHaveBeenCalledWith(false)
  })

  it('lists only LLM environment variables and binds the selected reference', async () => {
    const user = userEvent.setup()
    const handleModelSelectorChange = vi.fn()
    mockUseConfig.mockReturnValue(
      buildUseConfigResult({
        inputs: {
          ...baseNodeData,
          model_selector: [],
        },
        isEnvironmentModelSource: true,
        environmentVariables: [
          {
            id: 'env-llm',
            name: 'for_summarize',
            value_type: 'llm',
            value: {
              provider: 'openai',
              name: 'gpt-4o',
              mode: AppModeEnum.CHAT,
            },
            description: '',
          },
          {
            id: 'env-string',
            name: 'API_KEY',
            value_type: 'string',
            value: 'secret',
            description: '',
          },
        ],
        handleModelSelectorChange,
      }),
    )

    renderPanel({ model_selector: [] })

    expect(screen.getByTestId('model-parameter-modal')).toHaveAttribute(
      'data-model-selector-readonly',
      'true',
    )
    expect(screen.getByTestId('model-parameter-modal')).toHaveAttribute('data-readonly', 'true')
    await user.click(screen.getByText('workflow.nodes.common.typeSwitch.variable'))
    expect(screen.getByText('for_summarize')).toBeInTheDocument()
    expect(screen.queryByText('API_KEY')).not.toBeInTheDocument()

    await user.click(screen.getByText('for_summarize'))
    await waitFor(() => {
      expect(handleModelSelectorChange).toHaveBeenCalledWith(['env', 'for_summarize'], {})
    })
  })

  it('does not apply stale model parameters after switching back to direct input', async () => {
    const user = userEvent.setup()
    let resolveParameters!: (value: {
      params: Record<string, never>
      removedDetails: Record<string, never>
    }) => void
    mockFetchAndMergeValidCompletionParams.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveParameters = resolve
      }),
    )
    const handleModelSelectorChange = vi.fn()
    const handleModelSourceChange = vi.fn()
    const handleCompletionParamsChange = vi.fn()
    mockUseConfig.mockReturnValue(
      buildUseConfigResult({
        inputs: { ...baseNodeData, model_selector: [] },
        isEnvironmentModelSource: true,
        environmentVariables: [
          {
            id: 'env-llm',
            name: 'for_summarize',
            value_type: 'llm',
            value: { provider: 'openai', name: 'gpt-4o', mode: AppModeEnum.CHAT },
            description: '',
          },
        ],
        handleModelSelectorChange,
        handleModelSourceChange,
        handleCompletionParamsChange,
      }),
    )

    renderPanel({ model_selector: [] })
    await user.click(screen.getByText('workflow.nodes.common.typeSwitch.variable'))
    await user.click(screen.getByText('for_summarize'))
    expect(handleModelSelectorChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.typeSwitch.input' }))
    resolveParameters({ params: {}, removedDetails: {} })

    await waitFor(() => {
      expect(handleModelSourceChange).toHaveBeenCalledWith(false)
    })
    expect(handleCompletionParamsChange).not.toHaveBeenCalled()
    expect(handleModelSelectorChange).not.toHaveBeenCalled()
  })

  it('does not overwrite parameters edited while a model rules request is in flight', async () => {
    const user = userEvent.setup()
    let resolveParameters!: (value: {
      params: Record<string, number>
      removedDetails: Record<string, never>
    }) => void
    mockFetchAndMergeValidCompletionParams.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveParameters = resolve
      }),
    )
    const handleModelChanged = vi.fn()
    const handleCompletionParamsChange = vi.fn()
    mockUseConfig.mockReturnValue(
      buildUseConfigResult({
        inputs: {
          ...baseNodeData,
          model: { ...baseNodeData.model, completion_params: { temperature: 0.7 } },
        },
        handleModelChanged,
        handleCompletionParamsChange,
      }),
    )
    const rendered = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Select direct model' }))
    mockUseConfig.mockReturnValue(
      buildUseConfigResult({
        inputs: {
          ...baseNodeData,
          model: {
            ...baseNodeData.model,
            completion_params: { temperature: 0.9 },
          },
        },
        model: {
          ...baseNodeData.model,
          completion_params: { temperature: 0.9 },
        },
        handleModelChanged,
        handleCompletionParamsChange,
      }),
    )
    rendered.rerender(renderPanelElement())
    resolveParameters({ params: { temperature: 0.7 }, removedDetails: {} })

    await waitFor(() => expect(mockFetchAndMergeValidCompletionParams).toHaveBeenCalledTimes(1))
    expect(handleModelChanged).not.toHaveBeenCalled()
    expect(handleCompletionParamsChange).not.toHaveBeenCalled()
  })

  it('commits a direct model and its filtered parameters together', async () => {
    const user = userEvent.setup()
    let resolveParameters!: (value: {
      params: Record<string, number>
      removedDetails: Record<string, never>
    }) => void
    mockFetchAndMergeValidCompletionParams.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveParameters = resolve
      }),
    )
    const handleModelChanged = vi.fn()
    const handleCompletionParamsChange = vi.fn()
    mockUseConfig.mockReturnValue(
      buildUseConfigResult({ handleModelChanged, handleCompletionParamsChange }),
    )
    const rendered = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Select direct model' }))
    expect(handleModelChanged).not.toHaveBeenCalled()

    rendered.rerender(renderPanelElement())
    resolveParameters({ params: { temperature: 0.7 }, removedDetails: {} })

    await waitFor(() => {
      expect(handleModelChanged).toHaveBeenCalledWith(
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet' },
        { temperature: 0.7 },
      )
    })
    expect(handleCompletionParamsChange).not.toHaveBeenCalled()
  })

  it('preserves completion parameters when model rules cannot be fetched', async () => {
    const user = userEvent.setup()
    const handleModelChanged = vi.fn()
    const handleCompletionParamsChange = vi.fn()
    mockFetchAndMergeValidCompletionParams.mockRejectedValueOnce(new Error('network error'))
    mockUseConfig.mockReturnValue(
      buildUseConfigResult({ handleCompletionParamsChange, handleModelChanged }),
    )
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Select direct model' }))

    await waitFor(() => {
      expect(mockFetchAndMergeValidCompletionParams).toHaveBeenCalledTimes(1)
    })
    expect(handleModelChanged).not.toHaveBeenCalled()
    expect(handleCompletionParamsChange).not.toHaveBeenCalled()
  })
})
