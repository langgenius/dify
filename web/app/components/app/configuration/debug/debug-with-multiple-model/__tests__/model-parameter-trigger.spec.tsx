import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { ModelAndParameter } from '../../types'
import type {
  FormValue,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import ModelParameterTrigger from '../model-parameter-trigger'

const mockUseDebugConfigurationContext = vi.fn()
const mockUseDebugWithMultipleModelContext = vi.fn()
const mockProvidersSummary = vi.fn()
const mockUseCredentialPanelState = vi.fn()
const mockUseCurrentModel = vi.fn()

type ParameterModalProps = {
  isAdvancedMode: boolean
  provider: string
  modelId: string
  completionParams: FormValue
  onCompletionParamsChange: (params: FormValue) => void
  setModel: (model: { modelId: string; provider: string }) => void
  debugWithMultipleModel: boolean
  onDebugWithMultipleModelChange: () => void
  trigger: ReactNode
}

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('../context', () => ({
  useDebugWithMultipleModelContext: () => mockUseDebugWithMultipleModelContext(),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state',
  () => ({
    useCredentialPanelState: () => mockUseCredentialPanelState(),
  }),
)

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: () => mockUseCurrentModel(),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: (props: ParameterModalProps) => {
      return (
        <div>
          {props?.trigger}
          <button onClick={() => props?.setModel({ modelId: 'gpt-4', provider: 'openai' })}>
            Select GPT-4
          </button>
          <button onClick={() => props?.onCompletionParamsChange({ temperature: 0.8 })}>
            Save parameters
          </button>
          <button onClick={() => props?.onDebugWithMultipleModelChange()}>
            Use this model only
          </button>
        </div>
      )
    },
  }),
)

vi.mock('@/app/components/header/account-setting/model-provider-page/model-icon', () => ({
  default: ({ provider, modelName }: { provider: { provider: string }; modelName?: string }) => (
    <div data-testid="model-icon" data-provider={provider?.provider} data-model={modelName}>
      ModelIcon
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-name', () => ({
  default: ({ modelItem }: { modelItem: { model: string } }) => (
    <div data-testid="model-name">{modelItem?.model}</div>
  ),
}))

const createModelAndParameter = (
  overrides: Partial<ModelAndParameter> = {},
): ModelAndParameter => ({
  id: 'model-1',
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: { temperature: 0.7 },
  ...overrides,
})

const createModelProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  help: {
    title: { en_US: 'Help', zh_Hans: 'Help' },
    url: { en_US: 'https://example.com', zh_Hans: 'https://example.com' },
  },
  icon_small: { en_US: '', zh_Hans: '' },
  supported_model_types: [ModelTypeEnum.textGeneration],
  configurate_methods: [ConfigurationMethodEnum.predefinedModel],
  provider_credential_schema: {
    credential_form_schemas: [],
  },
  model_credential_schema: {
    model: {
      label: { en_US: 'Model', zh_Hans: 'Model' },
      placeholder: { en_US: 'Select model', zh_Hans: 'Select model' },
    },
    credential_form_schemas: [],
  },
  preferred_provider_type: PreferredProviderTypeEnum.custom,
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    current_credential_id: 'cred-1',
    current_credential_name: 'Primary Key',
    available_credentials: [{ credential_id: 'cred-1', credential_name: 'Primary Key' }],
  },
  system_configuration: {
    enabled: true,
    current_quota_type: CurrentSystemQuotaTypeEnum.trial,
    quota_configurations: [],
  },
  ...overrides,
})

const renderComponent = (props: Partial<{ modelAndParameter: ModelAndParameter }> = {}) => {
  const defaultProps = {
    modelAndParameter: createModelAndParameter(),
    ...props,
  }
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions().queryKey,
    { data: mockProvidersSummary(), plugins: {} },
  )
  return renderWithConsoleQuery(<ModelParameterTrigger {...defaultProps} />, { queryClient })
}

describe('ModelParameterTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseDebugConfigurationContext.mockReturnValue({
      isAdvancedMode: false,
    })

    mockUseDebugWithMultipleModelContext.mockReturnValue({
      multipleModelConfigs: [createModelAndParameter()],
      onMultipleModelConfigsChange: vi.fn(),
      onDebugWithMultipleModelChange: vi.fn(),
    })
    mockProvidersSummary.mockReturnValue(
      {
        data: [
          {
            ...createModelProvider(),
            is_configured: true,
            plugin_id: 'langgenius/openai',
          } as unknown as ModelProviderSummaryResponse,
        ],
      }.data,
    )
    mockUseCredentialPanelState.mockReturnValue({
      variant: 'api-active',
      priority: 'apiKey',
      supportsCredits: true,
      showPrioritySwitcher: true,
      hasCredentials: true,
      isCreditsExhausted: false,
      credentialName: 'Primary Key',
      credits: 10,
    })
    mockUseCurrentModel.mockReturnValue({ currentProvider: null, currentModel: null })
  })

  describe('handleSelectModel', () => {
    it('should update correct model in array', async () => {
      const user = userEvent.setup()
      const onMultipleModelConfigsChange = vi.fn()
      const models = [
        createModelAndParameter({ id: 'model-1' }),
        createModelAndParameter({ id: 'model-2' }),
        createModelAndParameter({ id: 'model-3' }),
      ]

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: models,
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent({ modelAndParameter: models[1] })

      await user.click(screen.getByRole('button', { name: 'Select GPT-4' }))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(true, [
        models[0],
        expect.objectContaining({
          id: 'model-2',
          model: 'gpt-4',
          provider: 'openai',
        }),
        models[2],
      ])
    })
  })

  describe('handleParamsChange', () => {
    it('should preserve other model properties when changing params', async () => {
      const user = userEvent.setup()
      const onMultipleModelConfigsChange = vi.fn()
      const modelAndParameter = createModelAndParameter({
        id: 'model-1',
        model: 'gpt-3.5-turbo',
        provider: 'openai',
        parameters: { temperature: 0.7 },
      })

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent({ modelAndParameter })

      await user.click(screen.getByRole('button', { name: 'Save parameters' }))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(true, [
        expect.objectContaining({
          id: 'model-1',
          model: 'gpt-3.5-turbo',
          provider: 'openai',
          parameters: { temperature: 0.8 },
        }),
      ])
    })
  })

  describe('onDebugWithMultipleModelChange', () => {
    it('should call context onDebugWithMultipleModelChange with modelAndParameter', async () => {
      const user = userEvent.setup()
      const onDebugWithMultipleModelChange = vi.fn()
      const modelAndParameter = createModelAndParameter()

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange,
      })

      renderComponent({ modelAndParameter })

      await user.click(screen.getByRole('button', { name: 'Use this model only' }))

      expect(onDebugWithMultipleModelChange).toHaveBeenCalledWith(modelAndParameter)
    })
  })

  describe('trigger rendering', () => {
    it('should render "Select Model" text when no provider or model is configured', () => {
      renderComponent({
        modelAndParameter: createModelAndParameter({
          provider: '',
          model: '',
        }),
      })

      // When currentProvider and currentModel are null, shows "Select Model"
      expect(screen.getByText('modelProvider.modelProvider.selectModel')).toBeInTheDocument()
    })

    it('should render configured model id and incompatible tooltip when model is missing from the provider list', async () => {
      const user = userEvent.setup()
      renderComponent()

      expect(screen.getByText('gpt-3.5-turbo')).toBeInTheDocument()
      const trigger = screen.getByRole('button', {
        name: /modelProvider.modelProvider.selector.incompatibleTip/,
      })
      await user.hover(trigger)
      expect(
        await screen.findByText(
          (content, element) =>
            content === 'modelProvider.modelProvider.selector.incompatibleTip' &&
            !!element &&
            !trigger.contains(element),
        ),
      ).toBeInTheDocument()
    })

    it('should render configure required tooltip for no-configure status', async () => {
      const user = userEvent.setup()
      mockUseCurrentModel.mockReturnValue({
        currentProvider: { provider: 'openai' },
        currentModel: { model: 'gpt-3.5-turbo', status: ModelStatusEnum.noConfigure },
      })
      renderComponent()

      const trigger = screen.getByRole('button', {
        name: /modelProvider.modelProvider.selector.configureRequired/,
      })
      await user.hover(trigger)
      expect(
        await screen.findByText(
          (content, element) =>
            content === 'modelProvider.modelProvider.selector.configureRequired' &&
            !!element &&
            !trigger.contains(element),
        ),
      ).toBeInTheDocument()
    })

    it('should render disabled tooltip for disabled status', async () => {
      const user = userEvent.setup()
      mockUseCurrentModel.mockReturnValue({
        currentProvider: { provider: 'openai' },
        currentModel: { model: 'gpt-3.5-turbo', status: ModelStatusEnum.disabled },
      })
      renderComponent()

      const trigger = screen.getByRole('button', {
        name: /modelProvider.modelProvider.selector.disabled/,
      })
      await user.hover(trigger)
      expect(
        await screen.findByText(
          (content, element) =>
            content === 'modelProvider.modelProvider.selector.disabled' &&
            !!element &&
            !trigger.contains(element),
        ),
      ).toBeInTheDocument()
    })
  })
})
