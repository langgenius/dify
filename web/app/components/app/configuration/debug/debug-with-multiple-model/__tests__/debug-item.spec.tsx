import type { CSSProperties } from 'react'
import type { ModelAndParameter } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import DebugItem from '../debug-item'

const mockUseDebugConfigurationContext = vi.fn()
const mockUseDebugWithMultipleModelContext = vi.fn()
const mockModelListQuery = vi.fn()

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('../context', () => ({
  useDebugWithMultipleModelContext: () => mockUseDebugWithMultipleModelContext(),
}))

vi.mock('../chat-item', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="chat-item" data-model-id={modelAndParameter.id}>
      ChatItem
    </div>
  ),
}))

vi.mock('../text-generation-item', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="text-generation-item" data-model-id={modelAndParameter.id}>
      TextGenerationItem
    </div>
  ),
}))

vi.mock('../model-parameter-trigger', () => ({
  default: () => {
    return <div data-testid="model-parameter-trigger">ModelParameterTrigger</div>
  },
}))

const createModelAndParameter = (
  overrides: Partial<ModelAndParameter> = {},
): ModelAndParameter => ({
  id: 'model-1',
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: {},
  ...overrides,
})

const createTextGenerationModelList = (
  models: Array<{ provider: string; model: string; status?: ModelStatusEnum }> = [],
) => {
  const providers: Record<
    string,
    { provider: string; models: Array<{ model: string; status: ModelStatusEnum }> }
  > = {}

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
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }).queryKey,
    mockModelListQuery(),
  )
  return renderWithConsoleQuery(<DebugItem {...defaultProps} />, { queryClient })
}

describe('DebugItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseDebugConfigurationContext.mockReturnValue({
      mode: 'chat' as const,
    })

    mockUseDebugWithMultipleModelContext.mockReturnValue({
      multipleModelConfigs: [createModelAndParameter()],
      onMultipleModelConfigsChange: vi.fn(),
      onDebugWithMultipleModelChange: vi.fn(),
    })

    mockModelListQuery.mockReturnValue({
      data: createTextGenerationModelList([{ provider: 'openai', model: 'gpt-3.5-turbo' }]),
    })
  })

  const openMenu = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    return user
  }

  describe('ChatItem rendering', () => {
    it('should render ChatItem in CHAT mode with active model', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: 'chat' as const })
      mockModelListQuery.mockReturnValue({
        data: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-3.5-turbo', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.getByTestId('chat-item'))!.toBeInTheDocument()
      expect(screen.queryByTestId('text-generation-item')).not.toBeInTheDocument()
    })

    it('should render ChatItem in AGENT_CHAT mode with active model', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: 'agent-chat' as const })
      mockModelListQuery.mockReturnValue({
        data: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-3.5-turbo', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.getByTestId('chat-item'))!.toBeInTheDocument()
    })

    it('should not render ChatItem when model is not active', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: 'chat' as const })
      mockModelListQuery.mockReturnValue({
        data: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-3.5-turbo', status: ModelStatusEnum.disabled },
        ]),
      })

      renderComponent()

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })

    it('should not render ChatItem when provider not found', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: 'chat' as const })
      mockModelListQuery.mockReturnValue({
        data: createTextGenerationModelList([
          { provider: 'anthropic', model: 'claude-3', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })

    it('should not render ChatItem when model not found', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: 'chat' as const })
      mockModelListQuery.mockReturnValue({
        data: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-4', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })
  })

  describe('TextGenerationItem rendering', () => {
    it('should render TextGenerationItem in COMPLETION mode with active model', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: 'completion' as const })
      mockModelListQuery.mockReturnValue({
        data: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-3.5-turbo', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.getByTestId('text-generation-item'))!.toBeInTheDocument()
      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })

    it('should not render TextGenerationItem when provider is not found', () => {
      mockUseDebugConfigurationContext.mockReturnValue({ mode: 'completion' as const })
      mockModelListQuery.mockReturnValue({
        data: createTextGenerationModelList([
          { provider: 'anthropic', model: 'claude-3', status: ModelStatusEnum.active },
        ]),
      })

      renderComponent()

      expect(screen.queryByTestId('text-generation-item')).not.toBeInTheDocument()
    })
  })

  describe('dropdown menu', () => {
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

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(true, [models[0], models[2]])
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

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(true, [
        models[0],
        models[1],
        expect.objectContaining({
          model: models[1]!.model,
          provider: models[1]!.provider,
          parameters: models[1]!.parameters,
        }),
        models[2],
      ])
      const duplicate = onMultipleModelConfigsChange.mock.calls[0]![1][2]
      expect(models.map((model) => model.id)).not.toContain(duplicate.id)
    })
  })

  describe('edge cases', () => {
    it('should handle empty textGenerationModelList', () => {
      mockModelListQuery.mockReturnValue({
        data: [],
      })

      renderComponent()

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
      expect(screen.queryByTestId('text-generation-item')).not.toBeInTheDocument()
    })
  })
})
