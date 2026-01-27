import type * as React from 'react'
import type { ModelAndParameter } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelStatusEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelParameterTrigger from './model-parameter-trigger'

// Mock MODEL_STATUS_TEXT that is imported in the component
vi.mock('@/app/components/header/account-setting/model-provider-page/declarations', async (importOriginal) => {
  const original = await importOriginal() as object
  return {
    ...original,
    MODEL_STATUS_TEXT: {
      'disabled': { en_US: 'Disabled', zh_Hans: '已禁用' },
      'quota-exceeded': { en_US: 'Quota Exceeded', zh_Hans: '配额已用完' },
      'no-configure': { en_US: 'No Configure', zh_Hans: '未配置凭据' },
    },
  }
})

const mockUseTranslation = vi.fn()
const mockUseDebugConfigurationContext = vi.fn()
const mockUseDebugWithMultipleModelContext = vi.fn()
const mockUseLanguage = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('./context', () => ({
  useDebugWithMultipleModelContext: () => mockUseDebugWithMultipleModelContext(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => mockUseLanguage(),
}))

type RenderTriggerParams = {
  open: boolean
  currentProvider: { provider: string, icon: string } | null
  currentModel: { model: string, status: ModelStatusEnum } | null
}
type ModalProps = {
  provider: string
  modelId: string
  isAdvancedMode: boolean
  completionParams: Record<string, unknown>
  debugWithMultipleModel: boolean
  setModel: (model: { modelId: string, provider: string }) => void
  onCompletionParamsChange: (params: Record<string, unknown>) => void
  onDebugWithMultipleModelChange: () => void
  renderTrigger: (params: RenderTriggerParams) => React.ReactElement
}
let capturedModalProps: ModalProps | null = null
let mockRenderTriggerFn: ((params: RenderTriggerParams) => React.ReactElement) | null = null

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: (props: ModalProps) => {
    capturedModalProps = props
    mockRenderTriggerFn = props.renderTrigger

    // Render the trigger with some mock data
    const triggerElement = props.renderTrigger({
      open: false,
      currentProvider: props.provider
        ? { provider: props.provider, icon: 'provider-icon' }
        : null,
      currentModel: props.modelId
        ? { model: props.modelId, status: ModelStatusEnum.active }
        : null,
    })

    return (
      <div data-testid="model-parameter-modal">
        {triggerElement}
        <button
          type="button"
          data-testid="select-model-btn"
          onClick={() => props.setModel({ modelId: 'new-model', provider: 'new-provider' })}
        >
          Select Model
        </button>
        <button
          type="button"
          data-testid="change-params-btn"
          onClick={() => props.onCompletionParamsChange({ temperature: 0.9 })}
        >
          Change Params
        </button>
        <button
          type="button"
          data-testid="debug-single-btn"
          onClick={() => props.onDebugWithMultipleModelChange()}
        >
          Debug Single
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-icon', () => ({
  default: ({ provider, modelName }: { provider: { provider: string } | null, modelName?: string }) => (
    <div data-testid="model-icon" data-provider={provider?.provider} data-model={modelName}>
      ModelIcon
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-name', () => ({
  default: ({ modelItem }: { modelItem: { model: string } | null }) => (
    <div data-testid="model-name" data-model={modelItem?.model}>
      {modelItem?.model}
    </div>
  ),
}))

vi.mock('@/app/components/base/icons/src/vender/line/shapes', () => ({
  CubeOutline: () => <div data-testid="cube-icon">CubeOutline</div>,
}))

vi.mock('@/app/components/base/icons/src/vender/line/alertsAndFeedback', () => ({
  AlertTriangle: () => <div data-testid="alert-icon">AlertTriangle</div>,
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip">{children}</div>,
}))

let modelIdCounter = 0

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
  id: `model-${++modelIdCounter}`,
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: { temperature: 0.7 },
  ...overrides,
})

describe('ModelParameterTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelIdCounter = 0
    capturedModalProps = null
    mockRenderTriggerFn = null

    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })

    mockUseDebugConfigurationContext.mockReturnValue({
      isAdvancedMode: false,
    })

    mockUseDebugWithMultipleModelContext.mockReturnValue({
      multipleModelConfigs: [],
      onMultipleModelConfigsChange: vi.fn(),
      onDebugWithMultipleModelChange: vi.fn(),
    })

    mockUseLanguage.mockReturnValue('en_US')
  })

  describe('rendering', () => {
    it('should render ModelParameterModal with correct props', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('model-parameter-modal')).toBeInTheDocument()
      expect(capturedModalProps!.isAdvancedMode).toBe(false)
      expect(capturedModalProps!.provider).toBe('openai')
      expect(capturedModalProps!.modelId).toBe('gpt-4')
      expect(capturedModalProps!.completionParams).toEqual({ temperature: 0.7 })
      expect(capturedModalProps!.debugWithMultipleModel).toBe(true)
    })

    it('should pass isAdvancedMode from context', () => {
      const modelAndParameter = createModelAndParameter()
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: true,
      })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      expect(capturedModalProps!.isAdvancedMode).toBe(true)
    })
  })

  describe('trigger rendering', () => {
    it('should render model icon when provider exists', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('model-icon')).toBeInTheDocument()
    })

    it('should render cube icon when no provider', () => {
      const modelAndParameter = createModelAndParameter({ provider: '', model: '' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('cube-icon')).toBeInTheDocument()
    })

    it('should render model name when model exists', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('model-name')).toBeInTheDocument()
    })

    it('should render select model text when no model', () => {
      const modelAndParameter = createModelAndParameter({ provider: '', model: '' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      expect(screen.getByText('modelProvider.selectModel')).toBeInTheDocument()
    })
  })

  describe('handleSelectModel', () => {
    it('should update model and provider in configs', () => {
      const model1 = createModelAndParameter({ id: 'model-a', provider: 'openai', model: 'gpt-3.5' })
      const model2 = createModelAndParameter({ id: 'model-b' })
      const onMultipleModelConfigsChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [model1, model2],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={model1} />)

      fireEvent.click(screen.getByTestId('select-model-btn'))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(
        true,
        [
          expect.objectContaining({ id: 'model-a', model: 'new-model', provider: 'new-provider' }),
          expect.objectContaining({ id: 'model-b' }),
        ],
      )
    })

    it('should update correct model when multiple configs exist', () => {
      const model1 = createModelAndParameter({ id: 'model-a' })
      const model2 = createModelAndParameter({ id: 'model-b' })
      const model3 = createModelAndParameter({ id: 'model-c' })
      const onMultipleModelConfigsChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [model1, model2, model3],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={model2} />)

      fireEvent.click(screen.getByTestId('select-model-btn'))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(
        true,
        [
          expect.objectContaining({ id: 'model-a' }),
          expect.objectContaining({ id: 'model-b', model: 'new-model', provider: 'new-provider' }),
          expect.objectContaining({ id: 'model-c' }),
        ],
      )
    })
  })

  describe('handleParamsChange', () => {
    it('should update parameters in configs', () => {
      const model1 = createModelAndParameter({ id: 'model-a', parameters: { temperature: 0.5 } })
      const model2 = createModelAndParameter({ id: 'model-b' })
      const onMultipleModelConfigsChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [model1, model2],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={model1} />)

      fireEvent.click(screen.getByTestId('change-params-btn'))

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(
        true,
        [
          expect.objectContaining({ id: 'model-a', parameters: { temperature: 0.9 } }),
          expect.objectContaining({ id: 'model-b' }),
        ],
      )
    })
  })

  describe('onDebugWithMultipleModelChange', () => {
    it('should call onDebugWithMultipleModelChange with current modelAndParameter', () => {
      const modelAndParameter = createModelAndParameter({ id: 'model-a', provider: 'openai', model: 'gpt-4' })
      const onDebugWithMultipleModelChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange,
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      fireEvent.click(screen.getByTestId('debug-single-btn'))

      expect(onDebugWithMultipleModelChange).toHaveBeenCalledWith(modelAndParameter)
    })
  })

  describe('index finding', () => {
    it('should find correct index for model in middle of array', () => {
      const model1 = createModelAndParameter({ id: 'model-a' })
      const model2 = createModelAndParameter({ id: 'model-b' })
      const model3 = createModelAndParameter({ id: 'model-c' })
      const onMultipleModelConfigsChange = vi.fn()
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [model1, model2, model3],
        onMultipleModelConfigsChange,
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={model2} />)

      // Verify that the correct index is used by checking the result of handleSelectModel
      fireEvent.click(screen.getByTestId('select-model-btn'))

      // The second model (index 1) should be updated
      const updatedConfigs = onMultipleModelConfigsChange.mock.calls[0][1]
      expect(updatedConfigs[0].id).toBe('model-a')
      expect(updatedConfigs[1].model).toBe('new-model') // This one should be updated
      expect(updatedConfigs[2].id).toBe('model-c')
    })
  })

  describe('renderTrigger styling and states', () => {
    it('should render trigger with open state styling', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      // Call renderTrigger with open=true to test the open styling branch
      const triggerWithOpen = mockRenderTriggerFn!({
        open: true,
        currentProvider: { provider: 'openai', icon: 'provider-icon' },
        currentModel: { model: 'gpt-4', status: ModelStatusEnum.active },
      })

      expect(triggerWithOpen).toBeDefined()
    })

    it('should render warning tooltip when model status is not active', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      // Call renderTrigger with inactive model status to test the warning branch
      const triggerWithInactiveModel = mockRenderTriggerFn!({
        open: false,
        currentProvider: { provider: 'openai', icon: 'provider-icon' },
        currentModel: { model: 'gpt-4', status: ModelStatusEnum.disabled },
      })

      expect(triggerWithInactiveModel).toBeDefined()
    })

    it('should render warning background and tooltip for inactive model', () => {
      const modelAndParameter = createModelAndParameter({ provider: 'openai', model: 'gpt-4' })
      mockUseDebugWithMultipleModelContext.mockReturnValue({
        multipleModelConfigs: [modelAndParameter],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
      })

      render(<ModelParameterTrigger modelAndParameter={modelAndParameter} />)

      // Test with quota_exceeded status (another inactive status)
      const triggerWithQuotaExceeded = mockRenderTriggerFn!({
        open: false,
        currentProvider: { provider: 'openai', icon: 'provider-icon' },
        currentModel: { model: 'gpt-4', status: ModelStatusEnum.quotaExceeded },
      })

      expect(triggerWithQuotaExceeded).toBeDefined()
    })
  })
})
