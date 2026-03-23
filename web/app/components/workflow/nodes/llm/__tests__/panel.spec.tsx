import type { LLMNodeType } from '../types'
import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ProviderContextState } from '@/context/provider-context'
import type { PanelProps } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { defaultPlan } from '@/app/components/billing/config'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useProviderContextSelector } from '@/context/provider-context'
import { AppModeEnum } from '@/types/app'
import { BlockEnum } from '../../../types'
import Panel from '../panel'

const mockUseConfig = vi.fn()

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: vi.fn(),
}))

vi.mock('../use-config', () => ({
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: () => <div data-testid="model-parameter-modal" />,
}))

vi.mock('../components/config-prompt', () => ({
  default: () => <div data-testid="config-prompt" />,
}))

vi.mock('../../_base/components/config-vision', () => ({
  default: () => null,
}))

vi.mock('../../_base/components/memory-config', () => ({
  default: () => null,
}))

vi.mock('../../_base/components/variable/var-reference-picker', () => ({
  default: () => null,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  default: () => null,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-list', () => ({
  default: () => null,
}))

vi.mock('../components/reasoning-format-config', () => ({
  default: () => null,
}))

vi.mock('../components/structure-output', () => ({
  default: () => null,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  VarItem: () => null,
}))

type MockUseConfigReturn = ReturnType<typeof mockUseConfig>

const modelProviderSelector = vi.mocked(useProviderContextSelector)

const createProviderContextState = (modelProviders: ModelProvider[]): ProviderContextState => ({
  modelProviders,
  refreshModelProviders: vi.fn(),
  textGenerationModelList: [],
  supportRetrievalMethods: [],
  isAPIKeySet: true,
  plan: defaultPlan,
  isFetchedPlan: true,
  enableBilling: false,
  onPlanInfoChanged: vi.fn(),
  enableReplaceWebAppLogo: false,
  modelLoadBalancingEnabled: false,
  datasetOperatorEnabled: false,
  enableEducationPlan: false,
  isEducationWorkspace: false,
  isEducationAccount: false,
  allowRefreshEducationVerify: false,
  educationAccountExpireAt: null,
  isLoadingEducationAccountInfo: false,
  isFetchingEducationAccountInfo: false,
  webappCopyrightEnabled: false,
  licenseLimit: {
    workspace_members: {
      size: 0,
      limit: 0,
    },
  },
  refreshLicenseLimit: vi.fn(),
  isAllowTransferWorkspace: false,
  isAllowPublishAsCustomKnowledgePipelineTemplate: false,
  humanInputEmailDeliveryEnabled: false,
})

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
  return render(
    <Panel
      id="llm-node"
      data={{ ...baseNodeData, ...data }}
      panelProps={panelProps}
    />,
  )
}

describe('LLM Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelProviderSelector.mockImplementation(selector => selector(
      createProviderContextState([createMockModelProvider('openai')]),
    ))
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
