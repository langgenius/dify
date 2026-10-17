import type { ReactNode, RefObject } from 'react'
import type { DebugWithSingleModelRefType } from '../index'
import type { ChatItem } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { ModelConfig } from '@/models/debug'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { ModelModeType, TransferMethod } from '@/types/app'
import DebugWithSingleModel from '../index'

function createMockModelConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return createModelConfigFixture({
    provider: 'openai',
    model_id: 'gpt-3.5-turbo',
    mode: ModelModeType.chat,
    configs: {
      prompt_template: 'Test template',
      prompt_variables: [{ key: 'var1', name: 'Variable 1', type: 'string', required: false }],
    },
    ...overrides,
  })
}

const { mockSsePost, mockToastError } = vi.hoisted(() => ({
  mockSsePost: vi.fn<typeof import('@/service/base').ssePost>(() => Promise.resolve()),
  mockToastError: vi.fn(),
}))

vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/service/base', () => ({
  ssePost: mockSsePost,
  post: vi.fn(() => Promise.resolve({ data: {} })),
  get: vi.fn(() => Promise.resolve({ data: {} })),
  del: vi.fn(() => Promise.resolve({ data: {} })),
  patch: vi.fn(() => Promise.resolve({ data: {} })),
}))

vi.mock('@/service/fetch', () => ({
  fetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}))

const {
  mockFetchConversationMessages,
  mockFetchSuggestedQuestions,
  mockStopChatMessageResponding,
} = vi.hoisted(() => ({
  mockFetchConversationMessages: vi.fn(),
  mockFetchSuggestedQuestions: vi.fn(),
  mockStopChatMessageResponding: vi.fn(),
}))

vi.mock('@/service/debug', () => ({
  fetchConversationMessages: mockFetchConversationMessages,
  fetchSuggestedQuestions: mockFetchSuggestedQuestions,
  stopChatMessageResponding: mockStopChatMessageResponding,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
  useParams: () => ({}),
}))

const mockDebugConfigContext = createDebugConfigurationFixture({
  readonly: false,
  canTestAndRun: true,
  appId: 'test-app-id',
  onOpenFeatures: vi.fn(),
  inputs: { var1: 'test input' },
  completionParams: { max_tokens: 100, temperature: 0.7 },
  modelConfig: createMockModelConfig(),
})

const { mockUseDebugConfigurationContext } = vi.hoisted(() => ({
  mockUseDebugConfigurationContext: vi.fn(),
}))

mockUseDebugConfigurationContext.mockReturnValue(mockDebugConfigContext)

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: mockUseDebugConfigurationContext,
}))

type FeatureState = {
  moreLikeThis: { enabled: boolean }
  opening: { enabled: boolean; opening_statement: string; suggested_questions: string[] }
  moderation: { enabled: boolean }
  speech2text: { enabled: boolean }
  text2speech: { enabled: boolean }
  file: { enabled: boolean }
  suggested: { enabled: boolean }
  citation: { enabled: boolean }
  annotationReply: { enabled: boolean }
}

const defaultFeatures: FeatureState = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false, opening_statement: '', suggested_questions: [] },
  moderation: { enabled: false },
  speech2text: { enabled: false },
  text2speech: { enabled: false },
  file: { enabled: false },
  suggested: { enabled: false },
  citation: { enabled: false },
  annotationReply: { enabled: false },
}
type FeatureSelector = (state: { features: FeatureState }) => unknown

let mockFeaturesState: FeatureState = { ...defaultFeatures }

const { mockUseFeatures } = vi.hoisted(() => ({
  mockUseFeatures: vi.fn(),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: mockUseFeatures,
}))

const mockConfigFromDebugContext = {
  pre_prompt: 'Test prompt',
  prompt_type: 'simple',
  user_input_form: [],
  dataset_query_variable: '',
  opening_statement: '',
  more_like_this: { enabled: false },
  suggested_questions: [],
  suggested_questions_after_answer: { enabled: false },
  text_to_speech: { enabled: false },
  speech_to_text: { enabled: false },
  retriever_resource: { enabled: false },
  sensitive_word_avoidance: { enabled: false },
  agent_mode: {},
  dataset_configs: {},
  file_upload: { enabled: false },
  annotation_reply: { enabled: false },
  supportAnnotation: true,
  appId: 'test-app-id',
  supportCitationHitInfo: true,
}

const { mockUseConfigFromDebugContext, mockUseFormattingChangedSubscription } = vi.hoisted(() => ({
  mockUseConfigFromDebugContext: vi.fn(),
  mockUseFormattingChangedSubscription: vi.fn(),
}))

mockUseConfigFromDebugContext.mockReturnValue(mockConfigFromDebugContext)

vi.mock('../../hooks', () => ({
  useConfigFromDebugContext: mockUseConfigFromDebugContext,
  useFormattingChangedSubscription: mockUseFormattingChangedSubscription,
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: vi.fn(() => ({
    formatTime: vi.fn((timestamp: number) => new Date(timestamp).toLocaleString()),
  })),
}))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: vi.fn(() => ({
      getAudioPlayer: vi.fn(),
      resetAudioPlayer: vi.fn(),
    })),
  },
}))

type MockChatProps = {
  readonly?: boolean
  chatList?: ChatItem[]
  isResponding?: boolean
  onSend?: (message: string, files?: FileEntity[]) => void
  onRegenerate?: (
    chatItem: ChatItem,
    editedQuestion?: { message: string; files?: FileEntity[] },
  ) => void
  onStopResponding?: () => void
  suggestedQuestions?: string[]
  questionIcon?: ReactNode
  answerIcon?: ReactNode
  onAnnotationAdded?: (
    annotationId: string,
    authorName: string,
    question: string,
    answer: string,
    index: number,
  ) => void
  onAnnotationEdited?: (question: string, answer: string, index: number) => void
  onAnnotationRemoved?: (index: number) => void
  switchSibling?: (siblingMessageId: string) => void
  onFeatureBarClick?: (state: boolean) => void
  showFeatureBar?: boolean
  featureBarReadonly?: boolean
  inputDisabled?: boolean
}

const mockFile: FileEntity = {
  id: 'file-1',
  name: 'test.png',
  size: 123,
  type: 'image/png',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'image',
}

const mockDocumentFile: FileEntity = {
  id: 'file-2',
  name: 'test.pdf',
  size: 456,
  type: 'application/pdf',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: SupportUploadFileTypes.document,
}

vi.mock('@/app/components/base/chat/chat', () => ({
  default: function MockChat({
    readonly,
    chatList,
    isResponding,
    onSend,
    onRegenerate,
    onStopResponding,
    suggestedQuestions,
    questionIcon,
    answerIcon,
    onAnnotationAdded,
    onAnnotationEdited,
    onAnnotationRemoved,
    switchSibling,
    onFeatureBarClick,
    showFeatureBar,
    featureBarReadonly,
    inputDisabled,
  }: MockChatProps) {
    const items = chatList || []
    const suggested = suggestedQuestions ?? []
    return (
      <div data-testid="chat-component">
        <div data-testid="chat-list">
          {items.map((item: ChatItem) => (
            <div key={item.id} data-testid={`chat-item-${item.id}`}>
              {item.content}
            </div>
          ))}
        </div>
        {!!questionIcon && <div data-testid="question-icon">{questionIcon}</div>}
        {!!answerIcon && <div data-testid="answer-icon">{answerIcon}</div>}
        <textarea
          data-testid="chat-input"
          placeholder="Type a message"
          readOnly={readonly}
          disabled={inputDisabled}
          onChange={() => {}}
        />
        <button
          data-testid="send-button"
          onClick={() => onSend?.('test message', [])}
          disabled={isResponding || readonly || inputDisabled}
        >
          Send
        </button>
        <button
          data-testid="send-with-files"
          onClick={() => onSend?.('test message', [mockFile])}
          disabled={isResponding || readonly || inputDisabled}
        >
          Send With Files
        </button>
        <button
          data-testid="send-with-document"
          onClick={() => onSend?.('test message', [mockDocumentFile])}
          disabled={isResponding || readonly || inputDisabled}
        >
          Send With Document
        </button>
        {isResponding && (
          <button data-testid="stop-button" onClick={onStopResponding}>
            Stop
          </button>
        )}
        {suggested.length > 0 && (
          <div data-testid="suggested-questions">
            {suggested.map((q: string) => (
              <button key={q} type="button" onClick={() => onSend?.(q, [])}>
                {q}
              </button>
            ))}
          </div>
        )}
        {onRegenerate && (
          <button
            data-testid="regenerate-button"
            onClick={() =>
              onRegenerate({
                id: 'msg-1',
                content: 'Question',
                isAnswer: false,
                message_files: [],
                parentMessageId: 'msg-0',
              })
            }
          >
            Regenerate
          </button>
        )}
        {switchSibling && (
          <button data-testid="switch-sibling-button" onClick={() => switchSibling('sibling-1')}>
            Switch
          </button>
        )}
        {showFeatureBar && onFeatureBarClick && (
          <button
            data-testid="feature-bar-button"
            disabled={featureBarReadonly}
            onClick={() => onFeatureBarClick(true)}
          >
            Features
          </button>
        )}
        {onAnnotationAdded && (
          <button
            data-testid="add-annotation-button"
            onClick={() => onAnnotationAdded('ann-1', 'user', 'q', 'a', 0)}
          >
            Add Annotation
          </button>
        )}
        {onAnnotationEdited && (
          <button
            data-testid="edit-annotation-button"
            onClick={() => onAnnotationEdited('q', 'a', 0)}
          >
            Edit Annotation
          </button>
        )}
        {onAnnotationRemoved && (
          <button data-testid="remove-annotation-button" onClick={() => onAnnotationRemoved(0)}>
            Remove Annotation
          </button>
        )}
      </div>
    )
  },
}))

const logProps = { onOpenLog: vi.fn(), chatContainerRef: createRef<HTMLDivElement>() }

describe('DebugWithSingleModel', () => {
  let ref: RefObject<DebugWithSingleModelRefType | null>

  beforeEach(() => {
    vi.clearAllMocks()
    mockSsePost.mockReset().mockResolvedValue(undefined)
    ref = createRef<DebugWithSingleModelRefType | null>()

    mockUseDebugConfigurationContext.mockReturnValue(mockDebugConfigContext)
    mockUseConfigFromDebugContext.mockReturnValue(mockConfigFromDebugContext)
    mockUseFormattingChangedSubscription.mockReturnValue(undefined)
    mockFeaturesState = { ...defaultFeatures }
    mockUseFeatures.mockImplementation((selector?: FeatureSelector) => {
      if (typeof selector === 'function') return selector({ features: mockFeaturesState })
      return mockFeaturesState
    })

    mockFetchConversationMessages.mockResolvedValue({ data: [] })
    mockFetchSuggestedQuestions.mockResolvedValue({ data: [] })
    mockStopChatMessageResponding.mockResolvedValue({})
  })

  describe('Props', () => {
    it('should respect checkCanSend returning true', async () => {
      const user = userEvent.setup()
      const checkCanSend = vi.fn(() => true)

      render(
        <DebugWithSingleModel
          {...logProps}
          ref={ref as RefObject<DebugWithSingleModelRefType>}
          checkCanSend={checkCanSend}
        />,
      )

      const sendButton = screen.getByTestId('send-button')
      await user.click(sendButton)

      await waitFor(() => {
        expect(checkCanSend).toHaveBeenCalled()
        expect(mockSsePost).toHaveBeenCalled()
      })

      expect(mockSsePost.mock.calls[0]![0]).toBe('apps/test-app-id/chat-messages')
      expect(mockSsePost.mock.calls[0]![1].body).toMatchObject({
        query: 'test message',
        inputs: { var1: 'test input' },
        parent_message_id: null,
        model_config: {
          model: {
            provider: 'openai',
            name: 'gpt-3.5-turbo',
            completion_params: { max_tokens: 100, temperature: 0.7 },
          },
        },
      })
      expect(mockSsePost.mock.calls[0]![2]).toEqual(
        expect.objectContaining({
          onNotifyError: expect.any(Function),
        }),
      )

      const callbacks = mockSsePost.mock.calls[0]![2] as {
        onNotifyError: (message: string) => void
      }
      callbacks.onNotifyError('Base model not found')
      expect(mockToastError).toHaveBeenCalledWith('Base model not found')
    })

    it('should prevent send when checkCanSend returns false', async () => {
      const user = userEvent.setup()
      const checkCanSend = vi.fn(() => false)

      render(
        <DebugWithSingleModel
          {...logProps}
          ref={ref as RefObject<DebugWithSingleModelRefType>}
          checkCanSend={checkCanSend}
        />,
      )

      const sendButton = screen.getByTestId('send-button')
      await user.click(sendButton)

      await waitFor(() => {
        expect(checkCanSend).toHaveBeenCalled()
        expect(checkCanSend).toHaveReturnedWith(false)
      })
      expect(mockSsePost).not.toHaveBeenCalled()
    })
  })

  describe('User Interactions', () => {
    it('should open feature configuration when feature bar is clicked', async () => {
      const user = userEvent.setup()
      render(
        <DebugWithSingleModel {...logProps} ref={ref as RefObject<DebugWithSingleModelRefType>} />,
      )

      await user.click(screen.getByTestId('feature-bar-button'))

      expect(mockDebugConfigContext.onOpenFeatures).toHaveBeenCalledTimes(1)
    })

    it('should allow sending but disable feature configuration when configuration is readonly and test/run is allowed', async () => {
      const user = userEvent.setup()
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        readonly: true,
        canTestAndRun: true,
      })

      render(
        <DebugWithSingleModel {...logProps} ref={ref as RefObject<DebugWithSingleModelRefType>} />,
      )

      expect(screen.getByTestId('chat-input')).not.toHaveAttribute('readonly')
      expect(screen.getByTestId('feature-bar-button')).toBeDisabled()
      expect(screen.queryByTestId('add-annotation-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('edit-annotation-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('remove-annotation-button')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('send-button'))

      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })
    })

    it('should block sending when test/run permission is missing', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        readonly: false,
        canTestAndRun: false,
      })

      render(
        <DebugWithSingleModel {...logProps} ref={ref as RefObject<DebugWithSingleModelRefType>} />,
      )

      expect(screen.getByTestId('chat-input')).toHaveAttribute('readonly')
      expect(screen.getByTestId('chat-input')).toBeDisabled()
      expect(screen.getByTestId('send-button')).toBeDisabled()
      expect(screen.getByTestId('feature-bar-button')).toBeInTheDocument()
      expect(screen.queryByTestId('add-annotation-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('edit-annotation-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('remove-annotation-button')).not.toBeInTheDocument()
    })
  })

  describe('Model Configuration', () => {
    it('should include opening features in request when enabled', async () => {
      const user = userEvent.setup()
      mockFeaturesState = {
        ...defaultFeatures,
        opening: { enabled: true, opening_statement: 'Hello!', suggested_questions: ['Q1'] },
      }

      render(
        <DebugWithSingleModel {...logProps} ref={ref as RefObject<DebugWithSingleModelRefType>} />,
      )

      await user.click(screen.getByTestId('send-button'))

      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })

      const body = mockSsePost.mock.calls[0]![1].body
      expect(body).toHaveProperty('model_config.opening_statement', 'Hello!')
      expect(body).toHaveProperty('model_config.suggested_questions', ['Q1'])
    })

    it('should omit opening statement when feature is disabled', async () => {
      const user = userEvent.setup()
      mockFeaturesState = {
        ...defaultFeatures,
        opening: {
          enabled: false,
          opening_statement: 'Should not appear',
          suggested_questions: ['Q1'],
        },
      }

      render(
        <DebugWithSingleModel {...logProps} ref={ref as RefObject<DebugWithSingleModelRefType>} />,
      )

      await user.click(screen.getByTestId('send-button'))

      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })

      const body = mockSsePost.mock.calls[0]![1].body
      expect(body).toHaveProperty('model_config.opening_statement', '')
      expect(body).toHaveProperty('model_config.suggested_questions', [])
    })
  })

  it('restarts the active conversation through the parent ref and allows a fresh request', async () => {
    const user = userEvent.setup()
    render(
      <DebugWithSingleModel {...logProps} ref={ref as RefObject<DebugWithSingleModelRefType>} />,
    )
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const callbacks = mockSsePost.mock.calls[0]![2]!
    act(() =>
      callbacks.onData?.('Streamed answer', true, {
        messageId: 'answer-1',
        conversationId: 'conversation-1',
        taskId: 'task-1',
      }),
    )
    expect(await screen.findByText('Streamed answer')).toBeVisible()
    act(() => ref.current!.handleRestart())
    expect(screen.queryByText('Streamed answer')).not.toBeInTheDocument()
    expect(screen.queryByText('test message')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(mockSsePost).toHaveBeenCalledTimes(2))
    expect(mockSsePost.mock.calls[1]![1].body).toHaveProperty('parent_message_id', null)
  })

  describe('File Upload', () => {
    it('serializes a document attachment when uploads are enabled', async () => {
      const user = userEvent.setup()
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        modelConfig: createMockModelConfig({
          model_id: 'gpt-3.5-turbo',
        }),
      })

      mockFeaturesState = {
        ...defaultFeatures,
        file: { enabled: true },
      }

      render(
        <DebugWithSingleModel {...logProps} ref={ref as RefObject<DebugWithSingleModelRefType>} />,
      )

      await user.click(screen.getByTestId('send-with-document'))

      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })

      const body = mockSsePost.mock.calls[0]![1].body
      expect(body).toHaveProperty('files', [
        {
          type: SupportUploadFileTypes.document,
          transfer_method: TransferMethod.local_file,
          url: '',
          upload_file_id: '',
        },
      ])
    })

    it('serializes an image attachment when uploads are enabled', async () => {
      const user = userEvent.setup()
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockDebugConfigContext,
        modelConfig: createMockModelConfig({
          model_id: 'gpt-4-vision',
        }),
      })

      mockFeaturesState = {
        ...defaultFeatures,
        file: { enabled: true },
      }

      render(
        <DebugWithSingleModel {...logProps} ref={ref as RefObject<DebugWithSingleModelRefType>} />,
      )

      await user.click(screen.getByTestId('send-with-files'))

      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })

      const body = mockSsePost.mock.calls[0]![1].body
      expect(body).toHaveProperty('files', [
        { type: 'image', transfer_method: TransferMethod.local_file, url: '', upload_file_id: '' },
      ])
    })
  })
})
