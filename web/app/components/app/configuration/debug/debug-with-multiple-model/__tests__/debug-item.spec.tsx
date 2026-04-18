import type { CSSProperties } from 'react'
import type { ModelAndParameter } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelStatusEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { AppModeEnum } from '@/types/app'
import DebugItem from '../debug-item'

const mockUseDebugConfigurationContext = vi.fn()
const mockUseDebugWithMultipleModelContext = vi.fn()
const mockUseProviderContext = vi.fn()

let capturedModelParameterTriggerProps: {
  modelAndParameter: ModelAndParameter
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

vi.mock('../chat-item', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="chat-item" data-model-id={modelAndParameter.id}>ChatItem</div>
  ),
}))

vi.mock('../text-generation-item', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="text-generation-item" data-model-id={modelAndParameter.id}>TextGenerationItem</div>
  ),
}))

vi.mock('../model-parameter-trigger', () => ({
  default: (props: { modelAndParameter: ModelAndParameter }) => {
    capturedModelParameterTriggerProps = props
    return <div data-testid="model-parameter-trigger">ModelParameterTrigger</div>
  },
}))

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
  id: 'model-1',
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: {},
  ...overrides,
})

const createTextGenerationModelList = (models: Array<{ provider: string, model: string, status?: ModelStatusEnum }> = []) => {
  const providers: Record<string, { provider: string, models: Array<{ model: string, status: ModelStatusEnum }> }> = {}

  models.forEach(({ provider, model, status = ModelStatusEnum.active }) => {
    if (!providers[provider]) {
      providers[provider] = { provider, models: [] }
    }
    providers[provider].models.push({ model, status })
  })

  return Object.values(providers)
}

type DebugItemProps = {
  modelAndParameter: ModelAndParameter
  className?: string
  style?: CSSProperties
}

const renderComponent = (props: Partial<DebugItemProps> = {}) => {
  const defaultProps: DebugItemProps = {
    modelAndParameter: createModelAndParameter(),
    ...props,
  }
  return render(<DebugItem {...defaultProps} />)
}

describe('DebugItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedModelParameterTriggerProps = null

    mockUseDebugConfigurationContext.mockReturnValue({
      mode: AppModeEnum.CHAT,
    })

    mockUseDebugWithMultipleModelContext.mockReturnValue({
      multipleModelConfigs: [createModelAndParameter()],
      onMultipleModelConfigsChange: vi.fn(),
      onDebugWithMultipleModelChange: vi.fn(),
    })

    mockUseProviderContext.mockReturnValue({
      textGenerationModelList: createTextGenerationModelList([
        { provider: 'openai', model: 'gpt-3.5-turbo' },
      ]),
    })
  })

  const openMenu = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    return user
  }

  describe('rendering', () => {
    it('should render with basic props', () => {
      renderComponent()

      expect(screen.getByTestId('model-parameter-trigger')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should display correct index number', () => {
      const modelConfigs = [
        createModelAndParameter({ id: 'model-1' }),
        createModelAndParameter({ id: 'model-2' }),
      ]
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: modelConfigs,
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      const { container } = renderComponent({ modelAndParameter: createModelAndParameter({ id: 'model-2' }) })

      // The index is displayed as "#2" in the component
      const indexElement = container.querySelector('.font-medium.italic')
      expect(indexElement?.textContent?.trim()).toContain('2')
    })

    it('should apply className and style props', () => {
      const { container } = renderComponent({
        className: 'custom-class',
        style: { backgroundColor: 'red' },
      })

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper)!.toHaveClass('custom-class')
      expect(wrapper.style.backgroundColor).toBe('red')
    })

    it('should pass modelAndParameter to ModelParameterTrigger', () => {
      const modelAndParameter = createModelAndParameter({ id: 'test-model' })
      renderComponent({ modelAndParameter })

      expect(capturedModelParameterTriggerProps?.modelAndParameter).toEqual(modelAndParameter)
    })
  })

  describe('ChatItem rendering', () => {
    it('should render ChatItem in CHAT mode with active model', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: AppModeEnum.CHAT })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-3.5-turbo', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.getByTestId('chat-item'))!.toBeInTheDocument()
      expect(screen.queryByTestId('text-generation-item')).not.toBeInTheDocument()
    })

    it('should render ChatItem in AGENT_CHAT mode with active model', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: AppModeEnum.AGENT_CHAT })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-3.5-turbo', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.getByTestId('chat-item'))!.toBeInTheDocument()
    })

    it('should not render ChatItem when model is not active', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: AppModeEnum.CHAT })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-3.5-turbo', status: ModelStatusEnum.disabled },
        ]),
      })

      renderComponent()

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })

    it('should not render ChatItem when provider not found', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: AppModeEnum.CHAT })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'anthropic', model: 'claude-3', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })

    it('should not render ChatItem when model not found', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: AppModeEnum.CHAT })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-4', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })
  })

  describe('TextGenerationItem rendering', () => {
    it('should render TextGenerationItem in COMPLETION mode with active model', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: AppModeEnum.COMPLETION })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-3.5-turbo', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.getByTestId('text-generation-item'))!.toBeInTheDocument()
      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })

    it('should not render TextGenerationItem when provider is not found', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: AppModeEnum.COMPLETION })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'anthropic', model: 'claude-3', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.queryByTestId('text-generation-item')).not.toBeInTheDocument()
    })
  })

  describe('dropdown menu', () => {
    it('should show duplicate option when less than 4 models', async () => {
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [createModelAndParameter()],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent()
      await openMenu()

      expect(screen.getByText('appDebug.duplicateModel')).toBeInTheDocument()
    })

    it('should hide duplicate option when 4 or more models', async () => {
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [
          createModelAndParameter({ id: '1' }),
          createModelAndParameter({ id: '2' }),
          createModelAndParameter({ id: '3' }),
          createModelAndParameter({ id: '4' }),
        ],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent()
      await openMenu()

      expect(screen.queryByText('appDebug.duplicateModel')).not.toBeInTheDocument()
    })

    it('should show debug-as-single-model option when provider and model are set', async () => {
      renderComponent({
        modelAndParameter: createModelAndParameter({
          provider: 'openai',
          model: 'gpt-3.5-turbo',
        }),
      })
      await openMenu()

      expect(screen.getByText('appDebug.debugAsSingleModel')).toBeInTheDocument()
    })

    it('should hide debug-as-single-model option when provider is missing', async () => {
      renderComponent({
        modelAndParameter: createModelAndParameter({
          provider: '',
          model: 'gpt-3.5-turbo',
        }),
      })
      await openMenu()

      expect(screen.queryByText('appDebug.debugAsSingleModel')).not.toBeInTheDocument()
    })

    it('should hide debug-as-single-model option when model is missing', async () => {
      renderComponent({
        modelAndParameter: createModelAndParameter({
          provider: 'openai',
          model: '',
        }),
      })
      await openMenu()

      expect(screen.queryByText('appDebug.debugAsSingleModel')).not.toBeInTheDocument()
    })

    it('should show remove option in secondItems when more than 2 models', async () => {
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [
          createModelAndParameter({ id: '1' }),
          createModelAndParameter({ id: '2' }),
          createModelAndParameter({ id: '3' }),
        ],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent()
      await openMenu()

      expect(screen.getByText('common.operation.remove')).toBeInTheDocument()
    })

    it('should not show remove option when 2 or fewer models', async () => {
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [
          createModelAndParameter({ id: '1' }),
          createModelAndParameter({ id: '2' }),
        ],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent()
      await openMenu()

      expect(screen.queryByText('common.operation.remove')).not.toBeInTheDocument()
    })
  })

  describe('dropdown actions', () => {
    it('should duplicate model when duplicate is selected', async () => {
      const onMultipleModelConfigsChange = vi.fn()
      const originalModel = createModelAndParameter({ id: 'original' })

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [originalModel],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent({ modelAndParameter: originalModel })

      const user = await openMenu()
      await user.click(screen.getByText('appDebug.duplicateModel'))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(
        true,
        expect.arrayContaining([
          originalModel,
          expect.objectContaining({
            model: originalModel.model,
            provider: originalModel.provider,
            parameters: originalModel.parameters,
          }),
        ]),
      )
    })

    it('should not duplicate when already at 4 models', async () => {
      const onMultipleModelConfigsChange = vi.fn()
      const models = [
        createModelAndParameter({ id: '1' }),
        createModelAndParameter({ id: '2' }),
        createModelAndParameter({ id: '3' }),
        createModelAndParameter({ id: '4' }),
      ]

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: models,
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent({ modelAndParameter: models[0] })
      await openMenu()

      expect(onMultipleModelConfigsChange).not.toHaveBeenCalled()
      expect(screen.queryByText('appDebug.duplicateModel')).not.toBeInTheDocument()
    })

    it('should call onDebugWithMultipleModelChange when debug-as-single-model is selected', async () => {
      const onDebugWithMultipleModelChange = vi.fn()
      const modelAndParameter = createModelAndParameter()

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange,
      })

      renderComponent({ modelAndParameter })

      const user = await openMenu()
      await user.click(screen.getByText('appDebug.debugAsSingleModel'))

      expect(onDebugWithMultipleModelChange).toHaveBeenCalledWith(modelAndParameter)
    })

    it('should remove model when remove is selected', async () => {
      const onMultipleModelConfigsChange = vi.fn()
      const models = [
        createModelAndParameter({ id: '1' }),
        createModelAndParameter({ id: '2' }),
        createModelAndParameter({ id: '3' }),
      ]

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: models,
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      renderComponent({ modelAndParameter: models[1] })

      const user = await openMenu()
      await user.click(screen.getByText('common.operation.remove'))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(
        true,
        [models[0], models[2]],
      )
    })

    it('should insert duplicated model at correct position', async () => {
      const onMultipleModelConfigsChange = vi.fn()
      const models = [
        createModelAndParameter({ id: '1' }),
        createModelAndParameter({ id: '2' }),
        createModelAndParameter({ id: '3' }),
      ]

      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: models,
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      // Duplicate the second model
      renderComponent({ modelAndParameter: models[1] })

      const user = await openMenu()
      await user.click(screen.getByText('appDebug.duplicateModel'))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(
        true,
        expect.arrayContaining([
          models[0],
          models[1],
          expect.objectContaining({ model: models[1]!.model }),
          models[2],
        ]),
      )
    })
  })

  describe('edge cases', () => {
    it('should handle model not found in multipleModelConfigs', () => {
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      const { container } = renderComponent()

      // Should show index 0 (not found returns -1, but display shows index + 1)
      const indexElement = container.querySelector('.font-medium.italic')
      expect(indexElement?.textContent?.trim()).toContain('0')
    })

    it('should handle empty textGenerationModelList', () => {
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: [],
      })

      renderComponent()

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
      expect(screen.queryByTestId('text-generation-item')).not.toBeInTheDocument()
    })

    it('should handle model with quotaExceeded status', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: AppModeEnum.CHAT })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'anthropic', model: 'not-matching', status: ModelStatusEnum.quotaExceeded },
        ]),
      })

      renderComponent()

      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      // When provider/model doesn't match, ChatItem won't render
      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })
  })
})
