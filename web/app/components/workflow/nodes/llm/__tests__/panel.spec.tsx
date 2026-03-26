import type { LLMNodeType } from '../types'
import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { PanelProps } from '@/types/workflow'
import { screen } from '@testing-library/react'
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
import { BlockEnum } from '../../../types'
import Panel from '../panel'

const mockUseConfig = vi.fn()

vi.mock('../use-config', () => ({
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: () => <div data-testid="model-parameter-modal" />,
}))

vi.mock('../../_base/components/variable/var-reference-picker', () => ({
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
  isChatModel: true,
  isChatMode: true,
  isCompletionModel: false,
  shouldShowContextTip: false,
  isVisionModel: false,
  handleModelChanged: vi.fn(),
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

const renderPanel = (data?: Partial<LLMNodeType>) => {
  return renderWorkflowFlowComponent(
    <ProviderContext.Provider value={createMockProviderContextValue({
      modelProviders: [createMockModelProvider('openai')],
      isFetchedPlan: true,
    })}
    >
      <Panel
        id="llm-node"
        data={{ ...baseNodeData, ...data }}
        panelProps={panelProps}
      />
    </ProviderContext.Provider>,
    {
      hooksStoreProps: {},
    },
  )
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
      mockUseConfig.mockReturnValue(buildUseConfigResult({
        inputs: {
          ...baseNodeData,
          model: {
            ...baseNodeData.model,
            provider: '',
            name: '',
          },
        },
      }))

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
})
