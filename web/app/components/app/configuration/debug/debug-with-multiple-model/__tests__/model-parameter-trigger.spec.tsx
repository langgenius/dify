import type { ReactNode } from 'react'
import type { ModelAndParameter } from '../../types'
import type {
  FormValue,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render, screen } from '@testing-library/react'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelParameterTrigger from '../model-parameter-trigger'

const mockUseDebugConfigurationContext = vi.fn()
const mockUseDebugWithMultipleModelContext = vi.fn()
const mockUseProviderContext = vi.fn()
const mockUseCredentialPanelState = vi.fn()

type RenderTriggerProps = {
  open: boolean
  currentProvider: { provider: string } | null
  currentModel: { model: string, status: ModelStatusEnum } | null
}

let capturedModalProps: {
  isAdvancedMode: boolean
  provider: string
  modelId: string
  completionParams: FormValue
  onCompletionParamsChange: (params: FormValue) => void
  setModel: (model: { modelId: string, provider: string }) => void
  debugWithMultipleModel: boolean
  onDebugWithMultipleModelChange: () => void
  renderTrigger: (props: RenderTriggerProps) => ReactNode
} | null = null

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('../context', () => ({
  useDebugWithMultipleModelContext: () => mockUseDebugWithMultipleModelContext(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: () => mockUseCredentialPanelState(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: (props: typeof capturedModalProps) => {
    capturedModalProps = props
    // Render the trigger that the component passes
    const triggerContent = props?.renderTrigger({
      open: false,
      currentProvider: null,
      currentModel: null,
    })
    return (
      <div data-testid="model-parameter-modal">
        {triggerContent}
      </div>
    )
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-icon', () => ({
  default: ({ provider, modelName }: { provider: { provider: string }, modelName?: string }) => (
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

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: ReactNode, popupContent: string }) => (
    <div data-testid="tooltip" data-content={popupContent}>{children}</div>
  ),
}))

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
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
  return render(<ModelParameterTrigger {...defaultProps} />)
}

describe('ModelParameterTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedModalProps = null

    mockUseDebugConfigurationContext.mockReturnValue({
      isAdvancedMode: false,
    })

    mockUseDebugWithMultipleModelContext.mockReturnValue({
      multipleModelConfigs: [createModelAndParameter()],
      onMultipleModelConfigsChange: vi.fn(),
      onDebugWithMultipleModelChange: vi.fn(),
    })
    mockUseProviderContext.mockReturnValue(createMockProviderContextValue({
      modelProviders: [createModelProvider()],
    }))
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
  })

  describe('rendering', () => {
    it('should render ModelParameterModal', () => {
      renderComponent()

      expect(screen.getByTestId('model-parameter-modal')).toBeInTheDocument()
    })

    it('should pass correct props to ModelParameterModal', () => {
      const modelAndParameter = createModelAndParameter({
        provider: 'anthropic',
        model: 'claude-3',
        parameters: { max_tokens: 1000 },
      })

      renderComponent({ modelAndParameter })

      expect(capturedModalProps?.provider).toBe('anthropic')
      expect(capturedModalProps?.modelId).toBe('claude-3')
      expect(capturedModalProps?.completionParams).toEqual({ max_tokens: 1000 })
      expect(capturedModalProps?.debugWithMultipleModel).toBe(true)
    })

    it('should pass isAdvancedMode from context', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: true,
      })

      renderComponent()

      expect(capturedModalProps?.isAdvancedMode).toBe(true)
    })
  })

  describe('handleSelectModel', () => {
    it('should call onMultipleModelConfigsChange with updated model', () => {
      const onMultipleModelConfigsChange = vi.fn()
      const modelAndParameter = createModelAndParameter({ id: 'model-1' })

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent({ modelAndParameter })

      // Directly call the setModel callback
      capturedModalProps?.setModel({ modelId: 'gpt-4', provider: 'openai' })

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(true, [
        expect.objectContaining({
          id: 'model-1',
          model: 'gpt-4',
          provider: 'openai',
        }),
      ])
    })

    it('should update correct model in array', () => {
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

      capturedModalProps?.setModel({ modelId: 'gpt-4', provider: 'openai' })

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
    it('should call onMultipleModelConfigsChange with updated parameters', () => {
      const onMultipleModelConfigsChange = vi.fn()
      const modelAndParameter = createModelAndParameter({ id: 'model-1' })

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent({ modelAndParameter })

      capturedModalProps?.onCompletionParamsChange({ temperature: 0.8 })

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(true, [
        expect.objectContaining({
          id: 'model-1',
          parameters: { temperature: 0.8 },
        }),
      ])
    })

    it('should preserve other model properties when changing params', () => {
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

      capturedModalProps?.onCompletionParamsChange({ temperature: 0.8 })

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
    it('should call context onDebugWithMultipleModelChange with modelAndParameter', () => {
      const onDebugWithMultipleModelChange = vi.fn()
      const modelAndParameter = createModelAndParameter()

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange,
      })

      renderComponent({ modelAndParameter })

      capturedModalProps?.onDebugWithMultipleModelChange()

      expect(onDebugWithMultipleModelChange).toHaveBeenCalledWith(modelAndParameter)
    })
  })

  describe('index calculation', () => {
    it('should find correct index in multipleModelConfigs', () => {
      const models = [
        createModelAndParameter({ id: 'model-1' }),
        createModelAndParameter({ id: 'model-2' }),
        createModelAndParameter({ id: 'model-3' }),
      ]

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: models,
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent({ modelAndParameter: models[2] })

      // The component uses the index to update the correct model
      // We verify this through the handleSelectModel behavior
      expect(capturedModalProps).not.toBeNull()
    })

    it('should handle model not found in configs', () => {
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [createModelAndParameter({ id: 'other' })],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      // Should not throw even if model is not found
      expect(() => renderComponent()).not.toThrow()
    })
  })

  describe('trigger rendering', () => {
    it('should render trigger content from renderTrigger', () => {
      renderComponent()

      // The trigger is rendered via renderTrigger callback
      expect(screen.getByTestId('model-parameter-modal')).toBeInTheDocument()
    })

    it('should render "Select Model" text when no provider or model is configured', () => {
      renderComponent({
        modelAndParameter: createModelAndParameter({
          provider: '',
          model: '',
        }),
      })

      // When currentProvider and currentModel are null, shows "Select Model"
      expect(screen.getByText('common.modelProvider.selectModel')).toBeInTheDocument()
    })

    it('should render configured model id and incompatible tooltip when model is missing from the provider list', () => {
      renderComponent()

      expect(screen.getByText('gpt-3.5-turbo')).toBeInTheDocument()
      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-content', 'common.modelProvider.selector.incompatibleTip')
    })

    it('should render configure required tooltip for no-configure status', () => {
      const { unmount } = renderComponent()
      const triggerContent = capturedModalProps?.renderTrigger({
        open: false,
        currentProvider: { provider: 'openai' },
        currentModel: { model: 'gpt-3.5-turbo', status: ModelStatusEnum.noConfigure },
      })

      unmount()
      render(<>{triggerContent}</>)

      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-content', 'common.modelProvider.selector.configureRequired')
    })

    it('should render disabled tooltip for disabled status', () => {
      const { unmount } = renderComponent()
      const triggerContent = capturedModalProps?.renderTrigger({
        open: false,
        currentProvider: { provider: 'openai' },
        currentModel: { model: 'gpt-3.5-turbo', status: ModelStatusEnum.disabled },
      })

      unmount()
      render(<>{triggerContent}</>)

      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-content', 'common.modelProvider.selector.disabled')
    })

    it('should apply expanded and warning styles when the trigger is open for a non-active status', () => {
      const { unmount } = renderComponent()
      const triggerContent = capturedModalProps?.renderTrigger({
        open: true,
        currentProvider: { provider: 'openai' },
        currentModel: { model: 'gpt-3.5-turbo', status: ModelStatusEnum.noConfigure },
      })

      unmount()
      const { container } = render(<>{triggerContent}</>)

      expect(container.firstChild).toHaveClass('bg-state-base-hover')
      expect(container.firstChild).toHaveClass('bg-[#FFFAEB]!')
    })
  })

  describe('edge cases', () => {
    it('should handle empty multipleModelConfigs', () => {
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      expect(() => renderComponent()).not.toThrow()
    })

    it('should handle undefined parameters', () => {
      const modelAndParameter = createModelAndParameter({
        parameters: undefined as unknown as FormValue,
      })

      expect(() => renderComponent({ modelAndParameter })).not.toThrow()
      expect(capturedModalProps?.completionParams).toBeUndefined()
    })

    it('should handle model selection for model not in list', () => {
      const onMultipleModelConfigsChange = vi.fn()
      const modelAndParameter = createModelAndParameter({ id: 'not-in-list' })

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [createModelAndParameter({ id: 'different-model' })],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent({ modelAndParameter })

      capturedModalProps?.setModel({ modelId: 'gpt-4', provider: 'openai' })

      // index will be -1, so newModelConfigs[-1] will be undefined
      // This tests the edge case behavior
      expect(onMultipleModelConfigsChange).toHaveBeenCalled()
    })
  })

  describe('renderTrigger with different states', () => {
    it('should pass correct props to renderTrigger', () => {
      renderComponent()

      expect(capturedModalProps?.renderTrigger).toBeDefined()
      expect(typeof capturedModalProps?.renderTrigger).toBe('function')
    })

    it('should render trigger with provider info when available', () => {
      // Mock the modal to render trigger with provider
      vi.doMock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
        default: (props: typeof capturedModalProps) => {
          capturedModalProps = props
          const triggerContent = props?.renderTrigger({
            open: false,
            currentProvider: { provider: 'openai' },
            currentModel: { model: 'gpt-3.5-turbo', status: ModelStatusEnum.active },
          })
          return (
            <div data-testid="model-parameter-modal">
              {triggerContent}
            </div>
          )
        },
      }))

      renderComponent()

      expect(screen.getByTestId('model-parameter-modal')).toBeInTheDocument()
    })
  })
})
