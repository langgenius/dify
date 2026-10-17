import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import type { ModelAndParameter } from '../../types'
import type { DebugWithMultipleModelContextType } from '../context'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { FeatureStoreState } from '@/app/components/base/features/store'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { Inputs, ModelConfig, PromptVariable } from '@/models/debug'
import { render as renderView, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createModelConfigFixture } from '@/test/fixtures/debug-configuration'
import { Resolution, TransferMethod } from '@/types/app'
import { APP_CHAT_WITH_MULTIPLE_MODEL } from '../../types'
import DebugWithMultipleModel from '../index'

type PromptVariableWithMeta = Omit<PromptVariable, 'type' | 'required'> & {
  type: PromptVariable['type'] | 'api'
  required?: boolean
  hide?: boolean
}

const mockUseDebugConfigurationContext = vi.fn()
const mockUseFeaturesSelector = vi.fn()
const observeDebugEvent = vi.fn()
let capturedChatInputProps: MockChatInputAreaProps | null = null
let modelIdCounter = 0
let featureState: FeatureStoreState

type MockChatInputAreaProps = {
  readonly?: boolean
  onSend?: (message: string, files?: FileEntity[]) => void
  onFeatureBarClick?: (state: boolean) => void
  showFeatureBar?: boolean
  showFileUpload?: boolean
  featureBarReadonly?: boolean
  disabled?: boolean
  inputs?: Record<string, string | number | boolean>
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
  useFeatures: (selector: (state: FeatureStoreState) => unknown) =>
    mockUseFeaturesSelector(selector),
}))

vi.mock('../debug-item', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="debug-item" data-model-id={modelAndParameter.id}>
      {modelAndParameter.model}
    </div>
  ),
}))

vi.mock('@/app/components/base/chat/chat/chat-input-area', () => ({
  default: (props: MockChatInputAreaProps) => {
    capturedChatInputProps = props
    return (
      <div data-testid="chat-input-area">
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => props.onSend?.('test message', mockFiles)}
        >
          send
        </button>
        {props.showFeatureBar && (
          <button
            type="button"
            disabled={props.featureBarReadonly}
            onClick={() => props.onFeatureBarClick?.(true)}
          >
            feature
          </button>
        )}
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

const createModelConfig = (promptVariables: PromptVariableWithMeta[] = []): ModelConfig =>
  createModelConfigFixture({
    configs: { prompt_template: '', prompt_variables: promptVariables },
  })

type DebugConfiguration = {
  onOpenFeatures: () => void
  mode: AppMode
  inputs: Inputs
  modelConfig: ModelConfig
  readonly: boolean
  canTestAndRun: boolean
}

const createDebugConfiguration = (
  overrides: Partial<DebugConfiguration> = {},
): DebugConfiguration => ({
  onOpenFeatures: vi.fn(),
  mode: 'chat' as const,
  inputs: {},
  modelConfig: createModelConfig(),
  readonly: false,
  canTestAndRun: true,
  ...overrides,
})

const createModelAndParameter = (
  overrides: Partial<ModelAndParameter> = {},
): ModelAndParameter => ({
  id: `model-${++modelIdCounter}`,
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: {},
  ...overrides,
})

const createProps = (
  overrides: Partial<DebugWithMultipleModelContextType> = {},
): DebugWithMultipleModelContextType => ({
  multipleModelConfigs: [createModelAndParameter()],
  onOpenLog: vi.fn(),
  onMultipleModelConfigsChange: vi.fn(),
  onDebugWithMultipleModelChange: vi.fn(),
  ...overrides,
})

function EventObserver({ children }: { children: ReactNode }) {
  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription(observeDebugEvent)
  return children
}

function render(ui: Parameters<typeof renderView>[0]) {
  return renderView(ui, {
    wrapper: ({ children }) => (
      <EventEmitterContextProvider>
        <EventObserver>{children}</EventObserver>
      </EventEmitterContextProvider>
    ),
  })
}

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
    mockUseFeaturesSelector.mockImplementation((selector) => selector(featureState))
    mockUseDebugConfigurationContext.mockReturnValue(createDebugConfiguration())
  })

  describe('props and callbacks', () => {
    it('updates the selected model when its configuration changes', () => {
      const props1 = createProps({
        multipleModelConfigs: [createModelAndParameter({ id: 'model-1' })],
      })
      const { rerender } = renderComponent(props1)

      const props2 = createProps({
        multipleModelConfigs: [createModelAndParameter({ id: 'model-2' })],
      })
      rerender(<DebugWithMultipleModel {...props2} />)

      const items = screen.getAllByTestId('debug-item')
      expect(items[0])!.toHaveAttribute('data-model-id', 'model-2')
    })
  })

  describe('prompt variables transformation', () => {
    it('should preserve original hide and required values', () => {
      const promptVariables: PromptVariableWithMeta[] = [
        {
          key: 'hidden-optional',
          name: 'Hidden Optional',
          type: 'string',
          hide: true,
          required: false,
        },
        {
          key: 'visible-required',
          name: 'Visible Required',
          type: 'number',
          hide: false,
          required: true,
        },
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
    it('should render chat input in chat mode with transformed prompt variables and feature handler', async () => {
      const user = userEvent.setup()

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

      renderComponent()
      await user.click(screen.getByRole('button', { name: /feature/i }))

      expect(screen.getByTestId('chat-input-area'))!.toBeInTheDocument()
      expect(capturedChatInputProps?.inputs).toEqual({ audience: 'engineers' })
      expect(capturedChatInputProps?.inputsForm).toEqual([
        expect.objectContaining({ label: 'City', variable: 'city', hide: false, required: true }),
        expect.objectContaining({
          label: 'Audience',
          variable: 'audience',
          hide: false,
          required: false,
        }),
        expect.objectContaining({
          label: 'Hidden',
          variable: 'hidden',
          hide: true,
          required: false,
        }),
      ])
      expect(capturedChatInputProps?.showFeatureBar).toBe(true)
      expect(capturedChatInputProps?.showFileUpload).toBe(false)
      expect(capturedChatInputProps?.speechToTextConfig).toEqual(featureState.features.speech2text)
      expect(capturedChatInputProps?.visionConfig).toEqual(featureState.features.file)
      expect(debugConfiguration.onOpenFeatures).toHaveBeenCalledTimes(1)
    })

    it('should allow sending but disable feature configuration when configuration is readonly and test/run is allowed', async () => {
      const user = userEvent.setup()
      mockUseDebugConfigurationContext.mockReturnValue(
        createDebugConfiguration({
          readonly: true,
          canTestAndRun: true,
        }),
      )

      renderComponent()
      await user.click(screen.getByRole('button', { name: /send/i }))

      expect(capturedChatInputProps?.readonly).toBe(false)
      expect(capturedChatInputProps?.disabled).toBe(false)
      expect(capturedChatInputProps?.showFeatureBar).toBe(true)
      expect(capturedChatInputProps?.featureBarReadonly).toBe(true)
      expect(screen.getByRole('button', { name: /feature/i })).toBeDisabled()
      expect(observeDebugEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: APP_CHAT_WITH_MULTIPLE_MODEL,
        }),
      )
    })

    it('should block sending when test/run permission is missing', async () => {
      const user = userEvent.setup()
      mockUseDebugConfigurationContext.mockReturnValue(
        createDebugConfiguration({
          canTestAndRun: false,
        }),
      )

      renderComponent()
      await user.click(screen.getByRole('button', { name: /send/i }))

      expect(capturedChatInputProps?.readonly).toBe(true)
      expect(capturedChatInputProps?.disabled).toBe(true)
      expect(observeDebugEvent).not.toHaveBeenCalled()
    })

    it('should render chat input in agent chat mode', () => {
      mockUseDebugConfigurationContext.mockReturnValue(
        createDebugConfiguration({
          mode: 'agent-chat' as const,
        }),
      )

      renderComponent()

      expect(screen.getByTestId('chat-input-area'))!.toBeInTheDocument()
    })

    it('should hide chat input when not in chat mode', () => {
      mockUseDebugConfigurationContext.mockReturnValue(
        createDebugConfiguration({
          mode: 'completion' as const,
        }),
      )
      const multipleModelConfigs = [createModelAndParameter()]

      renderComponent({ multipleModelConfigs })

      expect(screen.queryByTestId('chat-input-area')).not.toBeInTheDocument()
      expect(screen.getAllByTestId('debug-item')).toHaveLength(1)
    })
  })

  describe('sending flow', () => {
    it('should emit chat event when allowed to send', async () => {
      const user = userEvent.setup()

      const checkCanSend = vi.fn(() => true)
      const multipleModelConfigs = [createModelAndParameter(), createModelAndParameter()]
      renderComponent({ multipleModelConfigs, checkCanSend })

      await user.click(screen.getByRole('button', { name: /send/i }))

      expect(checkCanSend).toHaveBeenCalled()
      expect(observeDebugEvent).toHaveBeenCalledWith({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: {
          message: 'test message',
          files: mockFiles,
        },
      })
    })

    it('should emit when no checkCanSend is provided', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(screen.getByRole('button', { name: /send/i }))

      expect(observeDebugEvent).toHaveBeenCalledWith({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: {
          message: 'test message',
          files: mockFiles,
        },
      })
    })

    it('should block sending when checkCanSend returns false', async () => {
      const user = userEvent.setup()

      const checkCanSend = vi.fn(() => false)
      renderComponent({ checkCanSend })

      await user.click(screen.getByRole('button', { name: /send/i }))

      expect(checkCanSend).toHaveBeenCalled()
      expect(observeDebugEvent).not.toHaveBeenCalled()
    })
  })
})
