import type { ModelAndParameter } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelStatusEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { AppModeEnum } from '@/types/app'
import DebugItem from './debug-item'

const mockUseTranslation = vi.fn()
const mockUseDebugConfigurationContext = vi.fn()
const mockUseDebugWithMultipleModelContext = vi.fn()
const mockUseProviderContext = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('./context', () => ({
  useDebugWithMultipleModelContext: () => mockUseDebugWithMultipleModelContext(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('./chat-item', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="chat-item" data-model-id={modelAndParameter.id}>ChatItem</div>
  ),
}))

vi.mock('./text-generation-item', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="text-generation-item" data-model-id={modelAndParameter.id}>TextGenerationItem</div>
  ),
}))

vi.mock('./model-parameter-trigger', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="model-parameter-trigger" data-model-id={modelAndParameter.id}>ModelParameterTrigger</div>
  ),
}))

type DropdownItem = { value: string, text: string }
type DropdownProps = {
  items?: DropdownItem[]
  secondItems?: DropdownItem[]
  onSelect: (item: DropdownItem) => void
}
let capturedDropdownProps: DropdownProps | null = null
vi.mock('@/app/components/base/dropdown', () => ({
  default: (props: DropdownProps) => {
    capturedDropdownProps = props
    return (
      <div data-testid="dropdown">
        <button
          type="button"
          data-testid="dropdown-trigger"
          onClick={() => {
            // Mock dropdown menu showing items
          }}
        >
          Dropdown
        </button>
        {props.items?.map((item: DropdownItem) => (
          <button
            key={item.value}
            type="button"
            data-testid={`dropdown-item-${item.value}`}
            onClick={() => props.onSelect(item)}
          >
            {item.text}
          </button>
        ))}
        {props.secondItems?.map((item: DropdownItem) => (
          <button
            key={item.value}
            type="button"
            data-testid={`dropdown-second-item-${item.value}`}
            onClick={() => props.onSelect(item)}
          >
            {item.text}
          </button>
        ))}
      </div>
    )
  },
}))

let modelIdCounter = 0

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
  id: `model-${++modelIdCounter}`,
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: {},
  ...overrides,
})

const createTextGenerationModelList = (models: Array<{ provider: string, model: string, status?: ModelStatusEnum }> = []) => {
  const providerMap = new Map<string, { model: string, status: ModelStatusEnum, model_properties: { mode: string }, features: string[] }[]>()

  for (const m of models) {
    if (!providerMap.has(m.provider)) {
      providerMap.set(m.provider, [])
    }
    providerMap.get(m.provider)!.push({
      model: m.model,
      status: m.status ?? ModelStatusEnum.active,
      model_properties: { mode: 'chat' },
      features: [],
    })
  }

  return Array.from(providerMap.entries()).map(([provider, modelsList]) => ({
    provider,
    models: modelsList,
  }))
}

describe('DebugItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelIdCounter = 0
    capturedDropdownProps = null

    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })

    mockUseDebugConfigurationContext.mockReturnValue({
      mode: AppModeEnum.CHAT,
    })

    mockUseDebugWithMultipleModelContext.mockReturnValue({
      multipleModelConfigs: [],
      onMultipleModelConfigsChange: vi.fn(),
      onDebugWithMultipleModelChange: vi.fn(),
    })

    mockUseProviderContext.mockReturnValue({
      textGenerationModelList: [],
    })
  })

  describe('rendering', () => {
    it('should render with index number', () => {
      const modelAndParameter = createModelAndParameter({ id: 'model-a' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.getByText('#1')).toBeInTheDocument()
    })

    it('should render correct index for second model', () => {
      const model1 = createModelAndParameter({ id: 'model-a' })
      const model2 = createModelAndParameter({ id: 'model-b' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [model1, model2],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={model2} />)

      expect(screen.getByText('#2')).toBeInTheDocument()
    })

    it('should render ModelParameterTrigger', () => {
      const modelAndParameter = createModelAndParameter()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('model-parameter-trigger')).toBeInTheDocument()
    })

    it('should render Dropdown', () => {
      const modelAndParameter = createModelAndParameter()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('dropdown')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const modelAndParameter = createModelAndParameter()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      const { container } = render(<DebugItem modelAndParameter={modelAndParameter} className="custom-class" />)

      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should apply custom style', () => {
      const modelAndParameter = createModelAndParameter()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      const { container } = render(<DebugItem modelAndParameter={modelAndParameter} style={{ width: '300px' }} />)

      expect(container.firstChild).toHaveStyle({ width: '300px' })
    })
  })

  describe('ChatItem rendering', () => {
    it('should render ChatItem in CHAT mode with active model', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugConfigurationContext.mockReturnValue({
        mode: AppModeEnum.CHAT,
      })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-4', status: ModelStatusEnum.active },
        ]),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('chat-item')).toBeInTheDocument()
    })

    it('should render ChatItem in AGENT_CHAT mode with active model', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugConfigurationContext.mockReturnValue({
        mode: AppModeEnum.AGENT_CHAT,
      })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-4', status: ModelStatusEnum.active },
        ]),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('chat-item')).toBeInTheDocument()
    })

    it('should not render ChatItem when model is not active', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugConfigurationContext.mockReturnValue({
        mode: AppModeEnum.CHAT,
      })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-4', status: ModelStatusEnum.disabled },
        ]),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })

    it('should not render ChatItem when provider not found', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'unknown', model: 'model' })
      mockUseDebugConfigurationContext.mockReturnValue({
        mode: AppModeEnum.CHAT,
      })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-4', status: ModelStatusEnum.active },
        ]),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
    })
  })

  describe('TextGenerationItem rendering', () => {
    it('should render TextGenerationItem in COMPLETION mode with active model', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugConfigurationContext.mockReturnValue({
        mode: AppModeEnum.COMPLETION,
      })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-4', status: ModelStatusEnum.active },
        ]),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('text-generation-item')).toBeInTheDocument()
    })

    it('should not render TextGenerationItem when model is not active', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugConfigurationContext.mockReturnValue({
        mode: AppModeEnum.COMPLETION,
      })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-4', status: ModelStatusEnum.disabled },
        ]),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.queryByTestId('text-generation-item')).not.toBeInTheDocument()
    })

    it('should not render TextGenerationItem in CHAT mode', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugConfigurationContext.mockReturnValue({
        mode: AppModeEnum.CHAT,
      })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })
      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: createTextGenerationModelList([
          { provider: 'openai', model: 'gpt-4', status: ModelStatusEnum.active },
        ]),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(screen.queryByTestId('text-generation-item')).not.toBeInTheDocument()
    })
  })

  describe('dropdown menu items', () => {
    it('should show duplicate option when less than 4 models', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter, createModelAndParameter()],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(capturedDropdownProps!.items).toContainEqual(
        expect.objectContaining({ value: 'duplicate' }),
      )
    })

    it('should hide duplicate option when 4 or more models', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [
          modelAndParameter,
          createModelAndParameter(),
          createModelAndParameter(),
          createModelAndParameter(),
        ],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(capturedDropdownProps!.items).not.toContainEqual(
        expect.objectContaining({ value: 'duplicate' }),
      )
    })

    it('should show debug-as-single-model when provider and model are set', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(capturedDropdownProps!.items).toContainEqual(
        expect.objectContaining({ value: 'debug-as-single-model' }),
      )
    })

    it('should hide debug-as-single-model when provider is missing', () => {
      const modelAndParameter = createModelAndParameter({ provider: '', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(capturedDropdownProps!.items).not.toContainEqual(
        expect.objectContaining({ value: 'debug-as-single-model' }),
      )
    })

    it('should hide debug-as-single-model when model is missing', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: '' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(capturedDropdownProps!.items).not.toContainEqual(
        expect.objectContaining({ value: 'debug-as-single-model' }),
      )
    })

    it('should show remove option when more than 2 models', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter, createModelAndParameter(), createModelAndParameter()],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(capturedDropdownProps!.secondItems).toContainEqual(
        expect.objectContaining({ value: 'remove' }),
      )
    })

    it('should hide remove option when 2 or fewer models', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter, createModelAndParameter()],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      expect(capturedDropdownProps!.secondItems).toBeUndefined()
    })
  })

  describe('dropdown actions', () => {
    it('should duplicate model when clicking duplicate', () => {
      const modelAndParameter = createModelAndParameter({ id: 'model-a', provider: 'openai', model: 'gpt-4' })
      const model2 = createModelAndParameter({ id: 'model-b' })
      const onMultipleModelConfigsChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter, model2],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      fireEvent.click(screen.getByTestId('dropdown-item-duplicate'))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(
        true,
        expect.arrayContaining([
          expect.objectContaining({ id: 'model-a' }),
          expect.objectContaining({ provider: 'openai', model: 'gpt-4' }),
          expect.objectContaining({ id: 'model-b' }),
        ]),
      )
      expect(onMultipleModelConfigsChange.mock.calls[0][1]).toHaveLength(3)
    })

    it('should not duplicate when already at 4 models', () => {
      const modelAndParameter = createModelAndParameter({ id: 'model-a', provider: 'openai', model: 'gpt-4' })
      const onMultipleModelConfigsChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [
          modelAndParameter,
          createModelAndParameter(),
          createModelAndParameter(),
          createModelAndParameter(),
        ],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      // Duplicate option should not be rendered when at 4 models
      expect(screen.queryByTestId('dropdown-item-duplicate')).not.toBeInTheDocument()
    })

    it('should early return when trying to duplicate with 4 models via handleSelect', () => {
      const modelAndParameter = createModelAndParameter({ id: 'model-a', provider: 'openai', model: 'gpt-4' })
      const onMultipleModelConfigsChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [
          modelAndParameter,
          createModelAndParameter(),
          createModelAndParameter(),
          createModelAndParameter(),
        ],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      // Directly call handleSelect with duplicate action to cover line 42
      capturedDropdownProps!.onSelect({ value: 'duplicate', text: 'Duplicate' })

      // Should not call onMultipleModelConfigsChange due to early return
      expect(onMultipleModelConfigsChange).not.toHaveBeenCalled()
    })

    it('should call onDebugWithMultipleModelChange when clicking debug-as-single-model', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      const onDebugWithMultipleModelChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange,
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      fireEvent.click(screen.getByTestId('dropdown-item-debug-as-single-model'))

      expect(onDebugWithMultipleModelChange).toHaveBeenCalledWith(modelAndParameter)
    })

    it('should remove model when clicking remove', () => {
      const modelAndParameter = createModelAndParameter({ id: 'model-a', provider: 'openai', model: 'gpt-4' })
      const model2 = createModelAndParameter({ id: 'model-b' })
      const model3 = createModelAndParameter({ id: 'model-c' })
      const onMultipleModelConfigsChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter, model2, model3],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<DebugItem modelAndParameter={modelAndParameter} />)

      fireEvent.click(screen.getByTestId('dropdown-second-item-remove'))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(
        true,
        [
          expect.objectContaining({ id: 'model-b' }),
          expect.objectContaining({ id: 'model-c' }),
        ],
      )
    })
  })
})
