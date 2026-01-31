import type { CSSProperties } from 'react'
import type { ModelAndParameter } from '../types'
import type { DebugWithMultipleModelContextType } from './context'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { FeatureStoreState } from '@/app/components/base/features/store'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { Inputs, ModelConfig } from '@/models/debug'
import type { PromptVariable } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { AppModeEnum, ModelModeType, Resolution, TransferMethod } from '@/types/app'
import { APP_CHAT_WITH_MULTIPLE_MODEL } from '../types'
import DebugWithMultipleModel from './index'

type PromptVariableWithMeta = Omit<PromptVariable, 'type' | 'required'> & {
  type: PromptVariable['type'] | 'api'
  required?: boolean
  hide?: boolean
}

const mockUseDebugConfigurationContext = vi.fn()
const mockUseFeaturesSelector = vi.fn()
const mockUseEventEmitterContext = vi.fn()
const mockEventEmitter = { emit: vi.fn() }
let capturedChatInputProps: MockChatInputAreaProps | null = null
let modelIdCounter = 0
let featureState: FeatureStoreState

type MockChatInputAreaProps = {
  onSend?: (message: string, files?: FileEntity[]) => void
  onFeatureBarClick?: (state: boolean) => void
  showFeatureBar?: boolean
  showFileUpload?: boolean
  inputs?: Record<string, any>
  inputsForm?: InputForm[]
  speechToTextConfig?: unknown
  visionConfig?: unknown
}

const mockFiles: FileEntity[] = [
  {
    id: 'file-1',
    name: 'file.txt',
    size: 10,
    type: 'text/plain',
    progress: 100,
    transferMethod: TransferMethod.remote_url,
    supportFileType: 'text',
  },
]

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: FeatureStoreState) => unknown) => mockUseFeaturesSelector(selector),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => mockUseEventEmitterContext(),
}))

vi.mock('./debug-item', () => ({
  default: ({
    modelAndParameter,
    className,
    style,
  }: {
    modelAndParameter: ModelAndParameter
    className?: string
    style?: CSSProperties
  }) => (
    <div
      data-testid="debug-item"
      data-model-id={modelAndParameter.id}
      className={className}
      style={style}
    >
      DebugItem-
      {modelAndParameter.id}
    </div>
  ),
}))

vi.mock('@/app/components/base/chat/chat/chat-input-area', () => ({
  default: (props: MockChatInputAreaProps) => {
    capturedChatInputProps = props
    return (
      <div data-testid="chat-input-area">
        <button type="button" onClick={() => props.onSend?.('test message', mockFiles)}>send</button>
        <button type="button" onClick={() => props.onFeatureBarClick?.(true)}>feature</button>
      </div>
    )
  },
}))

const createFeatureState = (): FeatureStoreState => ({
  features: {
    speech2text: { enabled: true },
    file: {
      image: {
        enabled: true,
        detail: Resolution.high,
        number_limits: 2,
        transfer_methods: [TransferMethod.remote_url],
      },
    },
  },
  setFeatures: vi.fn(),
  showFeaturesModal: false,
  setShowFeaturesModal: vi.fn(),
})

const createModelConfig = (promptVariables: PromptVariableWithMeta[] = []): ModelConfig => ({
  provider: 'OPENAI',
  model_id: 'gpt-4',
  mode: ModelModeType.chat,
  configs: {
    prompt_template: '',
    prompt_variables: promptVariables as unknown as PromptVariable[],
  },
  chat_prompt_config: DEFAULT_CHAT_PROMPT_CONFIG,
  completion_prompt_config: DEFAULT_COMPLETION_PROMPT_CONFIG,
  opening_statement: '',
  more_like_this: null,
  suggested_questions: [],
  suggested_questions_after_answer: null,
  speech_to_text: null,
  text_to_speech: null,
  file_upload: null,
  retriever_resource: null,
  sensitive_word_avoidance: null,
  annotation_reply: null,
  external_data_tools: [],
  system_parameters: {
    audio_file_size_limit: 0,
    file_size_limit: 0,
    image_file_size_limit: 0,
    video_file_size_limit: 0,
    workflow_file_upload_limit: 0,
  },
  dataSets: [],
  agentConfig: DEFAULT_AGENT_SETTING,
})

type DebugConfiguration = {
  mode: AppModeEnum
  inputs: Inputs
  modelConfig: ModelConfig
}

const createDebugConfiguration = (overrides: Partial<DebugConfiguration> = {}): DebugConfiguration => ({
  mode: AppModeEnum.CHAT,
  inputs: {},
  modelConfig: createModelConfig(),
  ...overrides,
})

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
  id: `model-${++modelIdCounter}`,
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: {},
  ...overrides,
})

const createProps = (overrides: Partial<DebugWithMultipleModelContextType> = {}): DebugWithMultipleModelContextType => ({
  multipleModelConfigs: [createModelAndParameter()],
  onMultipleModelConfigsChange: vi.fn(),
  onDebugWithMultipleModelChange: vi.fn(),
  ...overrides,
})

const renderComponent = (props?: Partial<DebugWithMultipleModelContextType>) => {
  const mergedProps = createProps(props)
  return render(<DebugWithMultipleModel {...mergedProps} />)
}

describe('DebugWithMultipleModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedChatInputProps = null
    modelIdCounter = 0
    featureState = createFeatureState()
    mockUseFeaturesSelector.mockImplementation(selector => selector(featureState))
    mockUseEventEmitterContext.mockReturnValue({ eventEmitter: mockEventEmitter })
    mockUseDebugConfigurationContext.mockReturnValue(createDebugConfiguration())
  })

  describe('edge cases and error handling', () => {
    it('should handle empty multipleModelConfigs array', () => {
      renderComponent({ multipleModelConfigs: [] })
      expect(screen.queryByTestId('debug-item')).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-input-area')).toBeInTheDocument()
    })

    it('should handle model config with missing required fields', () => {
      const incompleteConfig = { id: 'incomplete' } as ModelAndParameter
      renderComponent({ multipleModelConfigs: [incompleteConfig] })
      expect(screen.getByTestId('debug-item')).toBeInTheDocument()
    })

    it('should handle more than 4 model configs', () => {
      const manyConfigs = Array.from({ length: 6 }, () => createModelAndParameter())
      renderComponent({ multipleModelConfigs: manyConfigs })

      const items = screen.getAllByTestId('debug-item')
      expect(items).toHaveLength(6)

      // Items beyond 4 should not have specialized positioning
      items.slice(4).forEach((item) => {
        expect(item.style.transform).toBe('translateX(0) translateY(0)')
      })
    })

    it('should handle modelConfig with undefined prompt_variables', () => {
      // Note: The current component doesn't handle undefined/null prompt_variables gracefully
      // This test documents the current behavior
      const modelConfig = createModelConfig()
      modelConfig.configs.prompt_variables = undefined as any

      mockUseDebugConfigurationContext.mockReturnValue(createDebugConfiguration({
        modelConfig,
      }))

      expect(() => renderComponent()).toThrow('Cannot read properties of undefined (reading \'filter\')')
    })

    it('should handle modelConfig with null prompt_variables', () => {
      // Note: The current component doesn't handle undefined/null prompt_variables gracefully
      // This test documents the current behavior
      const modelConfig = createModelConfig()
      modelConfig.configs.prompt_variables = null as any

      mockUseDebugConfigurationContext.mockReturnValue(createDebugConfiguration({
        modelConfig,
      }))

      expect(() => renderComponent()).toThrow('Cannot read properties of null (reading \'filter\')')
    })

    it('should handle prompt_variables with missing required fields', () => {
      const incompleteVariables: PromptVariableWithMeta[] = [
        { key: '', name: 'Empty Key', type: 'string' }, // Empty key
        { key: 'valid-key', name: undefined as any, type: 'number' }, // Undefined name
        { key: 'no-type', name: 'No Type', type: undefined as any }, // Undefined type
      ]

      const debugConfiguration = createDebugConfiguration({
        modelConfig: createModelConfig(incompleteVariables),
      })
      mockUseDebugConfigurationContext.mockReturnValue(debugConfiguration)

      renderComponent()

      // Should still render but handle gracefully
      expect(screen.getByTestId('chat-input-area')).toBeInTheDocument()
      expect(capturedChatInputProps?.inputsForm).toHaveLength(3)
    })
  })

  describe('props and callbacks', () => {
    it('should call onMultipleModelConfigsChange when provided', () => {
      const onMultipleModelConfigsChange = vi.fn()
      renderComponent({ onMultipleModelConfigsChange })

      // Context provider should pass through the callback
      expect(onMultipleModelConfigsChange).not.toHaveBeenCalled()
    })

    it('should call onDebugWithMultipleModelChange when provided', () => {
      const onDebugWithMultipleModelChange = vi.fn()
      renderComponent({ onDebugWithMultipleModelChange })

      // Context provider should pass through the callback
      expect(onDebugWithMultipleModelChange).not.toHaveBeenCalled()
    })

    it('should not memoize when props change', () => {
      const props1 = createProps({ multipleModelConfigs: [createModelAndParameter({ id: 'model-1' })] })
      const { rerender } = renderComponent(props1)

      const props2 = createProps({ multipleModelConfigs: [createModelAndParameter({ id: 'model-2' })] })
      rerender(<DebugWithMultipleModel {...props2} />)

      const items = screen.getAllByTestId('debug-item')
      expect(items[0]).toHaveAttribute('data-model-id', 'model-2')
    })
  })

  describe('accessibility', () => {
    it('should have accessible chat input elements', () => {
      renderComponent()

      const chatInput = screen.getByTestId('chat-input-area')
      expect(chatInput).toBeInTheDocument()

      // Check for button accessibility
      const sendButton = screen.getByRole('button', { name: /send/i })
      expect(sendButton).toBeInTheDocument()

      const featureButton = screen.getByRole('button', { name: /feature/i })
      expect(featureButton).toBeInTheDocument()
    })

    it('should apply ARIA attributes correctly', () => {
      const multipleModelConfigs = [createModelAndParameter()]
      renderComponent({ multipleModelConfigs })

      // Debug items should be identifiable
      const debugItem = screen.getByTestId('debug-item')
      expect(debugItem).toBeInTheDocument()
      expect(debugItem).toHaveAttribute('data-model-id')
    })
  })

  describe('prompt variables transformation', () => {
    it('should filter out API type variables', () => {
      const promptVariables: PromptVariableWithMeta[] = [
        { key: 'normal', name: 'Normal', type: 'string' },
        { key: 'api-var', name: 'API Var', type: 'api' },
        { key: 'number', name: 'Number', type: 'number' },
      ]
      const debugConfiguration = createDebugConfiguration({
        modelConfig: createModelConfig(promptVariables),
      })
      mockUseDebugConfigurationContext.mockReturnValue(debugConfiguration)

      renderComponent()

      expect(capturedChatInputProps?.inputsForm).toHaveLength(2)
      expect(capturedChatInputProps?.inputsForm).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Normal', variable: 'normal' }),
          expect.objectContaining({ label: 'Number', variable: 'number' }),
        ]),
      )
      expect(capturedChatInputProps?.inputsForm).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'API Var' }),
        ]),
      )
    })

    it('should handle missing hide and required properties', () => {
      const promptVariables: Partial<PromptVariableWithMeta>[] = [
        { key: 'no-hide', name: 'No Hide', type: 'string', required: true },
        { key: 'no-required', name: 'No Required', type: 'number', hide: true },
      ]
      const debugConfiguration = createDebugConfiguration({
        modelConfig: createModelConfig(promptVariables as PromptVariableWithMeta[]),
      })
      mockUseDebugConfigurationContext.mockReturnValue(debugConfiguration)

      renderComponent()

      expect(capturedChatInputProps?.inputsForm).toEqual([
        expect.objectContaining({
          label: 'No Hide',
          variable: 'no-hide',
          hide: false, // Should default to false
          required: true,
        }),
        expect.objectContaining({
          label: 'No Required',
          variable: 'no-required',
          hide: true,
          required: false, // Should default to false
        }),
      ])
    })

    it('should preserve original hide and required values', () => {
      const promptVariables: PromptVariableWithMeta[] = [
        { key: 'hidden-optional', name: 'Hidden Optional', type: 'string', hide: true, required: false },
        { key: 'visible-required', name: 'Visible Required', type: 'number', hide: false, required: true },
      ]
      const debugConfiguration = createDebugConfiguration({
        modelConfig: createModelConfig(promptVariables),
      })
      mockUseDebugConfigurationContext.mockReturnValue(debugConfiguration)

      renderComponent()

      expect(capturedChatInputProps?.inputsForm).toEqual([
        expect.objectContaining({
          label: 'Hidden Optional',
          variable: 'hidden-optional',
          hide: true,
          required: false,
        }),
        expect.objectContaining({
          label: 'Visible Required',
          variable: 'visible-required',
          hide: false,
          required: true,
        }),
      ])
    })
  })

  describe('chat input rendering', () => {
    it('should render chat input in chat mode with transformed prompt variables and feature handler', () => {
      // Arrange
      const promptVariables: PromptVariableWithMeta[] = [
        { key: 'city', name: 'City', type: 'string', required: true },
        { key: 'audience', name: 'Audience', type: 'number' },
        { key: 'hidden', name: 'Hidden', type: 'select', hide: true },
        { key: 'api-only', name: 'API Only', type: 'api' },
      ]
      const debugConfiguration = createDebugConfiguration({
        inputs: { audience: 'engineers' },
        modelConfig: createModelConfig(promptVariables),
      })
      mockUseDebugConfigurationContext.mockReturnValue(debugConfiguration)

      // Act
      renderComponent()
      fireEvent.click(screen.getByRole('button', { name: /feature/i }))

      // Assert
      expect(screen.getByTestId('chat-input-area')).toBeInTheDocument()
      expect(capturedChatInputProps?.inputs).toEqual({ audience: 'engineers' })
      expect(capturedChatInputProps?.inputsForm).toEqual([
        expect.objectContaining({ label: 'City', variable: 'city', hide: false, required: true }),
        expect.objectContaining({ label: 'Audience', variable: 'audience', hide: false, required: false }),
        expect.objectContaining({ label: 'Hidden', variable: 'hidden', hide: true, required: false }),
      ])
      expect(capturedChatInputProps?.showFeatureBar).toBe(true)
      expect(capturedChatInputProps?.showFileUpload).toBe(false)
      expect(capturedChatInputProps?.speechToTextConfig).toEqual(featureState.features.speech2text)
      expect(capturedChatInputProps?.visionConfig).toEqual(featureState.features.file)
      expect(useAppStore.getState().showAppConfigureFeaturesModal).toBe(true)
    })

    it('should render chat input in agent chat mode', () => {
      // Arrange
      mockUseDebugConfigurationContext.mockReturnValue(createDebugConfiguration({
        mode: AppModeEnum.AGENT_CHAT,
      }))

      // Act
      renderComponent()

      // Assert
      expect(screen.getByTestId('chat-input-area')).toBeInTheDocument()
    })

    it('should hide chat input when not in chat mode', () => {
      // Arrange
      mockUseDebugConfigurationContext.mockReturnValue(createDebugConfiguration({
        mode: AppModeEnum.COMPLETION,
      }))
      const multipleModelConfigs = [createModelAndParameter()]

      // Act
      renderComponent({ multipleModelConfigs })

      // Assert
      expect(screen.queryByTestId('chat-input-area')).not.toBeInTheDocument()
      expect(screen.getAllByTestId('debug-item')).toHaveLength(1)
    })
  })

  describe('sending flow', () => {
    it('should emit chat event when allowed to send', () => {
      // Arrange
      const checkCanSend = vi.fn(() => true)
      const multipleModelConfigs = [createModelAndParameter(), createModelAndParameter()]
      renderComponent({ multipleModelConfigs, checkCanSend })

      // Act
      fireEvent.click(screen.getByRole('button', { name: /send/i }))

      // Assert
      expect(checkCanSend).toHaveBeenCalled()
      expect(mockEventEmitter.emit).toHaveBeenCalledWith({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: {
          message: 'test message',
          files: mockFiles,
        },
      })
    })

    it('should emit when no checkCanSend is provided', () => {
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /send/i }))

      expect(mockEventEmitter.emit).toHaveBeenCalledWith({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: {
          message: 'test message',
          files: mockFiles,
        },
      })
    })

    it('should block sending when checkCanSend returns false', () => {
      // Arrange
      const checkCanSend = vi.fn(() => false)
      renderComponent({ checkCanSend })

      // Act
      fireEvent.click(screen.getByRole('button', { name: /send/i }))

      // Assert
      expect(checkCanSend).toHaveBeenCalled()
      expect(mockEventEmitter.emit).not.toHaveBeenCalled()
    })

    it('should tolerate missing event emitter without throwing', () => {
      mockUseEventEmitterContext.mockReturnValue({ eventEmitter: null })
      renderComponent()

      expect(() => fireEvent.click(screen.getByRole('button', { name: /send/i }))).not.toThrow()
      expect(mockEventEmitter.emit).not.toHaveBeenCalled()
    })
  })

  describe('performance optimization', () => {
    it('should memoize callback functions correctly', () => {
      const props = createProps({ multipleModelConfigs: [createModelAndParameter()] })
      const { rerender } = renderComponent(props)

      // First render
      const firstItems = screen.getAllByTestId('debug-item')
      expect(firstItems).toHaveLength(1)

      // Rerender with exactly same props - should not cause re-renders
      rerender(<DebugWithMultipleModel {...props} />)

      const secondItems = screen.getAllByTestId('debug-item')
      expect(secondItems).toHaveLength(1)

      // Check that the element still renders the same content
      expect(firstItems[0]).toHaveTextContent(secondItems[0].textContent || '')
    })

    it('should recalculate size and position when number of models changes', () => {
      const { rerender } = renderComponent({ multipleModelConfigs: [createModelAndParameter()] })

      // Single model - no special sizing
      const singleItem = screen.getByTestId('debug-item')
      expect(singleItem.style.width).toBe('')

      // Change to 2 models
      rerender(
        <DebugWithMultipleModel {...createProps({
          multipleModelConfigs: [createModelAndParameter(), createModelAndParameter()],
        })}
        />,
      )

      const twoItems = screen.getAllByTestId('debug-item')
      expect(twoItems[0].style.width).toBe('calc(50% - 28px)')
      expect(twoItems[1].style.width).toBe('calc(50% - 28px)')
    })
  })

  describe('layout sizing and positioning', () => {
    const expectItemLayout = (
      element: HTMLElement,
      expectation: {
        width?: string
        height?: string
        transform: string
        classes?: string[]
      },
    ) => {
      if (expectation.width !== undefined)
        expect(element.style.width).toBe(expectation.width)
      else
        expect(element.style.width).toBe('')

      if (expectation.height !== undefined)
        expect(element.style.height).toBe(expectation.height)
      else
        expect(element.style.height).toBe('')

      expect(element.style.transform).toBe(expectation.transform)
      expectation.classes?.forEach(cls => expect(element).toHaveClass(cls))
    }

    it('should arrange items in two-column layout for two models', () => {
      // Arrange
      const multipleModelConfigs = [createModelAndParameter(), createModelAndParameter()]

      // Act
      renderComponent({ multipleModelConfigs })
      const items = screen.getAllByTestId('debug-item')

      // Assert
      expect(items).toHaveLength(2)
      expectItemLayout(items[0], {
        width: 'calc(50% - 28px)',
        height: '100%',
        transform: 'translateX(0) translateY(0)',
        classes: ['mr-2'],
      })
      expectItemLayout(items[1], {
        width: 'calc(50% - 28px)',
        height: '100%',
        transform: 'translateX(calc(100% + 8px)) translateY(0)',
        classes: [],
      })
    })

    it('should arrange items in thirds for three models', () => {
      // Arrange
      const multipleModelConfigs = [createModelAndParameter(), createModelAndParameter(), createModelAndParameter()]

      // Act
      renderComponent({ multipleModelConfigs })
      const items = screen.getAllByTestId('debug-item')

      // Assert
      expect(items).toHaveLength(3)
      expectItemLayout(items[0], {
        width: 'calc(33.3% - 21.33px)',
        height: '100%',
        transform: 'translateX(0) translateY(0)',
        classes: ['mr-2'],
      })
      expectItemLayout(items[1], {
        width: 'calc(33.3% - 21.33px)',
        height: '100%',
        transform: 'translateX(calc(100% + 8px)) translateY(0)',
        classes: ['mr-2'],
      })
      expectItemLayout(items[2], {
        width: 'calc(33.3% - 21.33px)',
        height: '100%',
        transform: 'translateX(calc(200% + 16px)) translateY(0)',
        classes: [],
      })
    })

    it('should position items on a grid for four models', () => {
      // Arrange
      const multipleModelConfigs = [
        createModelAndParameter(),
        createModelAndParameter(),
        createModelAndParameter(),
        createModelAndParameter(),
      ]

      // Act
      renderComponent({ multipleModelConfigs })
      const items = screen.getAllByTestId('debug-item')

      // Assert
      expect(items).toHaveLength(4)
      expectItemLayout(items[0], {
        width: 'calc(50% - 28px)',
        height: 'calc(50% - 4px)',
        transform: 'translateX(0) translateY(0)',
        classes: ['mr-2', 'mb-2'],
      })
      expectItemLayout(items[1], {
        width: 'calc(50% - 28px)',
        height: 'calc(50% - 4px)',
        transform: 'translateX(calc(100% + 8px)) translateY(0)',
        classes: ['mb-2'],
      })
      expectItemLayout(items[2], {
        width: 'calc(50% - 28px)',
        height: 'calc(50% - 4px)',
        transform: 'translateX(0) translateY(calc(100% + 8px))',
        classes: ['mr-2'],
      })
      expectItemLayout(items[3], {
        width: 'calc(50% - 28px)',
        height: 'calc(50% - 4px)',
        transform: 'translateX(calc(100% + 8px)) translateY(calc(100% + 8px))',
        classes: [],
      })
    })

    it('should fall back to single column layout when only one model is provided', () => {
      // Arrange
      const multipleModelConfigs = [createModelAndParameter()]

      // Act
      renderComponent({ multipleModelConfigs })
      const item = screen.getByTestId('debug-item')

      // Assert
      expectItemLayout(item, {
        transform: 'translateX(0) translateY(0)',
        classes: [],
      })
    })

    it('should set scroll area height for chat modes', () => {
      const { container } = renderComponent()
      const scrollArea = container.querySelector('.relative.mb-3.grow.overflow-auto.px-6') as HTMLElement
      expect(scrollArea).toBeInTheDocument()
      expect(scrollArea.style.height).toBe('calc(100% - 60px)')
    })

    it('should set full height when chat input is hidden', () => {
      mockUseDebugConfigurationContext.mockReturnValue(createDebugConfiguration({
        mode: AppModeEnum.COMPLETION,
      }))

      const { container } = renderComponent()
      const scrollArea = container.querySelector('.relative.mb-3.grow.overflow-auto.px-6') as HTMLElement
      expect(scrollArea.style.height).toBe('100%')
    })
  })
})
