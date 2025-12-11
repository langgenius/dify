import '@testing-library/jest-dom'
import type { CSSProperties } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import DebugWithMultipleModel from './index'
import type { DebugWithMultipleModelContextType } from './context'
import { APP_CHAT_WITH_MULTIPLE_MODEL } from '../types'
import type { ModelAndParameter } from '../types'
import type { Inputs, ModelConfig } from '@/models/debug'
import { DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import type { FeatureStoreState } from '@/app/components/base/features/store'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import { AppModeEnum, ModelModeType, type PromptVariable, Resolution, TransferMethod } from '@/types/app'

type PromptVariableWithMeta = Omit<PromptVariable, 'type' | 'required'> & {
  type: PromptVariable['type'] | 'api'
  required?: boolean
  hide?: boolean
}

const mockUseDebugConfigurationContext = jest.fn()
const mockUseFeaturesSelector = jest.fn()
const mockUseEventEmitterContext = jest.fn()
const mockUseAppStoreSelector = jest.fn()
const mockEventEmitter = { emit: jest.fn() }
const mockSetShowAppConfigureFeaturesModal = jest.fn()
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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

jest.mock('@/context/debug-configuration', () => ({
  __esModule: true,
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

jest.mock('@/app/components/base/features/hooks', () => ({
  __esModule: true,
  useFeatures: (selector: (state: FeatureStoreState) => unknown) => mockUseFeaturesSelector(selector),
}))

jest.mock('@/context/event-emitter', () => ({
  __esModule: true,
  useEventEmitterContextContext: () => mockUseEventEmitterContext(),
}))

jest.mock('@/app/components/app/store', () => ({
  __esModule: true,
  useStore: (selector: (state: { setShowAppConfigureFeaturesModal: typeof mockSetShowAppConfigureFeaturesModal }) => unknown) => mockUseAppStoreSelector(selector),
}))

jest.mock('./debug-item', () => ({
  __esModule: true,
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
      data-testid='debug-item'
      data-model-id={modelAndParameter.id}
      className={className}
      style={style}
    >
      DebugItem-{modelAndParameter.id}
    </div>
  ),
}))

jest.mock('@/app/components/base/chat/chat/chat-input-area', () => ({
  __esModule: true,
  default: (props: MockChatInputAreaProps) => {
    capturedChatInputProps = props
    return (
      <div data-testid='chat-input-area'>
        <button type='button' onClick={() => props.onSend?.('test message', mockFiles)}>send</button>
        <button type='button' onClick={() => props.onFeatureBarClick?.(true)}>feature</button>
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
  setFeatures: jest.fn(),
  showFeaturesModal: false,
  setShowFeaturesModal: jest.fn(),
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
  onMultipleModelConfigsChange: jest.fn(),
  onDebugWithMultipleModelChange: jest.fn(),
  ...overrides,
})

const renderComponent = (props?: Partial<DebugWithMultipleModelContextType>) => {
  const mergedProps = createProps(props)
  return render(<DebugWithMultipleModel {...mergedProps} />)
}

describe('DebugWithMultipleModel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedChatInputProps = null
    modelIdCounter = 0
    featureState = createFeatureState()
    mockUseFeaturesSelector.mockImplementation(selector => selector(featureState))
    mockUseEventEmitterContext.mockReturnValue({ eventEmitter: mockEventEmitter })
    mockUseAppStoreSelector.mockImplementation(selector => selector({ setShowAppConfigureFeaturesModal: mockSetShowAppConfigureFeaturesModal }))
    mockUseDebugConfigurationContext.mockReturnValue(createDebugConfiguration())
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
      expect(mockSetShowAppConfigureFeaturesModal).toHaveBeenCalledWith(true)
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
      const checkCanSend = jest.fn(() => true)
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
      const checkCanSend = jest.fn(() => false)
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
        width: 'calc(50% - 4px - 24px)',
        height: '100%',
        transform: 'translateX(0) translateY(0)',
        classes: ['mr-2'],
      })
      expectItemLayout(items[1], {
        width: 'calc(50% - 4px - 24px)',
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
        width: 'calc(33.3% - 5.33px - 16px)',
        height: '100%',
        transform: 'translateX(0) translateY(0)',
        classes: ['mr-2'],
      })
      expectItemLayout(items[1], {
        width: 'calc(33.3% - 5.33px - 16px)',
        height: '100%',
        transform: 'translateX(calc(100% + 8px)) translateY(0)',
        classes: ['mr-2'],
      })
      expectItemLayout(items[2], {
        width: 'calc(33.3% - 5.33px - 16px)',
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
        width: 'calc(50% - 4px - 24px)',
        height: 'calc(50% - 4px)',
        transform: 'translateX(0) translateY(0)',
        classes: ['mr-2', 'mb-2'],
      })
      expectItemLayout(items[1], {
        width: 'calc(50% - 4px - 24px)',
        height: 'calc(50% - 4px)',
        transform: 'translateX(calc(100% + 8px)) translateY(0)',
        classes: ['mb-2'],
      })
      expectItemLayout(items[2], {
        width: 'calc(50% - 4px - 24px)',
        height: 'calc(50% - 4px)',
        transform: 'translateX(0) translateY(calc(100% + 8px))',
        classes: ['mr-2'],
      })
      expectItemLayout(items[3], {
        width: 'calc(50% - 4px - 24px)',
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
