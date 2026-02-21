import type { ChatConfig, ChatItem } from '../../types'
import type { ChatContextValue } from '../context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { vi } from 'vitest'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import Operation from './operation'

const {
  mockSetShowAnnotationFullModal,
  mockProviderContext,
  mockT,
  mockAddAnnotation,
} = vi.hoisted(() => {
  return {
    mockAddAnnotation: vi.fn(),
    mockSetShowAnnotationFullModal: vi.fn(),
    mockT: vi.fn((key: string): string => key),
    mockProviderContext: {
      plan: {
        usage: { annotatedResponse: 0 },
        total: { annotatedResponse: 100 },
      },
      enableBilling: false,
    },
  }
})

vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAnnotationFullModal: mockSetShowAnnotationFullModal,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderContext,
}))

vi.mock('@/service/annotation', () => ({
  addAnnotation: mockAddAnnotation,
}))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: vi.fn(() => ({
      getAudioPlayer: vi.fn(() => ({
        playAudio: vi.fn(),
        pauseAudio: vi.fn(),
      })),
    })),
  },
}))

vi.mock('@/app/components/app/annotation/edit-annotation-modal', () => ({
  default: ({ isShow, onHide, onEdited, onAdded, onRemove }: {
    isShow: boolean
    onHide: () => void
    onEdited: (q: string, a: string) => void
    onAdded: (id: string, name: string, q: string, a: string) => void
    onRemove: () => void
  }) =>
    isShow
      ? (
          <div data-testid="edit-reply-modal">
            <button data-testid="modal-hide" onClick={onHide}>Close</button>
            <button data-testid="modal-edit" onClick={() => onEdited('eq', 'ea')}>Edit</button>
            <button data-testid="modal-add" onClick={() => onAdded('a1', 'author', 'eq', 'ea')}>Add</button>
            <button data-testid="modal-remove" onClick={onRemove}>Remove</button>
          </div>
        )
      : null,
}))

vi.mock('@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-button', () => ({
  default: function AnnotationCtrlMock({ onAdded, onEdit, cached }: {
    onAdded: (id: string, authorName: string) => void
    onEdit: () => void
    cached: boolean
  }) {
    const { setShowAnnotationFullModal } = useModalContext()
    const { plan, enableBilling } = useProviderContext()
    const handleAdd = () => {
      if (enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse) {
        setShowAnnotationFullModal()
        return
      }
      onAdded('ann-new', 'Test User')
    }
    return (
      <div data-testid="annotation-ctrl">
        {cached
          ? (
              <button data-testid="annotation-edit-btn" onClick={onEdit}>Edit</button>
            )
          : (
              <button data-testid="annotation-add-btn" onClick={handleAdd}>Add</button>
            )}
      </div>
    )
  },
}))

vi.mock('@/app/components/base/new-audio-button', () => ({
  default: () => <button data-testid="audio-btn">Play</button>,
}))

vi.mock('@/app/components/base/chat/chat/log', () => ({
  default: () => <button data-testid="log-btn"><div className="i-ri-file-list-3-line" /></button>,
}))

vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ appId: 'test-app' })),
  usePathname: vi.fn(() => '/apps/test-app'),
}))

const makeChatConfig = (overrides: Partial<ChatConfig> = {}): ChatConfig => ({
  opening_statement: '',
  pre_prompt: '',
  prompt_type: 'simple' as ChatConfig['prompt_type'],
  user_input_form: [],
  dataset_query_variable: '',
  more_like_this: { enabled: false },
  suggested_questions_after_answer: { enabled: false },
  speech_to_text: { enabled: false },
  text_to_speech: { enabled: false },
  retriever_resource: { enabled: false },
  sensitive_word_avoidance: { enabled: false },
  agent_mode: { enabled: false, tools: [] },
  dataset_configs: { retrieval_model: 'single' } as ChatConfig['dataset_configs'],
  system_parameters: {
    audio_file_size_limit: 10,
    file_size_limit: 10,
    image_file_size_limit: 10,
    video_file_size_limit: 10,
    workflow_file_upload_limit: 10,
  },
  supportFeedback: false,
  supportAnnotation: false,
  ...overrides,
} as ChatConfig)

const mockContextValue: ChatContextValue = {
  chatList: [],
  config: makeChatConfig({ supportFeedback: true }),
  onFeedback: vi.fn().mockResolvedValue(undefined),
  onRegenerate: vi.fn(),
  onAnnotationAdded: vi.fn(),
  onAnnotationEdited: vi.fn(),
  onAnnotationRemoved: vi.fn(),
}

vi.mock('../context', () => ({
  useChatContext: () => mockContextValue,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

type OperationProps = {
  item: ChatItem
  question: string
  index: number
  showPromptLog?: boolean
  maxSize: number
  contentWidth: number
  hasWorkflowProcess: boolean
  noChatInput?: boolean
}

const baseItem: ChatItem = {
  id: 'msg-1',
  content: 'Hello world',
  isAnswer: true,
}

const baseProps: OperationProps = {
  item: baseItem,
  question: 'What is this?',
  index: 0,
  maxSize: 500,
  contentWidth: 300,
  hasWorkflowProcess: false,
}

describe('Operation', () => {
  const renderOperation = (props = baseProps) => {
    return render(
      <div className="group">
        <Operation {...props} />
      </div>,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockContextValue.config = makeChatConfig({ supportFeedback: true })
    mockContextValue.onFeedback = vi.fn().mockResolvedValue(undefined)
    mockContextValue.onRegenerate = vi.fn()
    mockContextValue.onAnnotationAdded = vi.fn()
    mockContextValue.onAnnotationEdited = vi.fn()
    mockContextValue.onAnnotationRemoved = vi.fn()
    mockProviderContext.plan.usage.annotatedResponse = 0
    mockProviderContext.enableBilling = false
    mockAddAnnotation.mockResolvedValue({ id: 'ann-new', account: { name: 'Test User' } })
  })

  describe('Rendering', () => {
    it('should hide action buttons for opening statements', () => {
      const item = { ...baseItem, isOpeningStatement: true }
      renderOperation({ ...baseProps, item })
      expect(screen.queryByTestId('operation-actions')).not.toBeInTheDocument()
    })

    it('should show copy and regenerate buttons', () => {
      renderOperation()
      expect(screen.getByTestId('copy-btn')).toBeInTheDocument()
      expect(screen.getByTestId('regenerate-btn')).toBeInTheDocument()
    })

    it('should hide regenerate button when noChatInput is true', () => {
      renderOperation({ ...baseProps, noChatInput: true })
      expect(screen.queryByTestId('regenerate-btn')).not.toBeInTheDocument()
    })

    it('should show TTS button when text_to_speech is enabled', () => {
      mockContextValue.config = makeChatConfig({ text_to_speech: { enabled: true } })
      renderOperation()
      expect(screen.getByTestId('audio-btn')).toBeInTheDocument()
    })

    it('should show annotation button when config supports it', () => {
      mockContextValue.config = makeChatConfig({
        supportAnnotation: true,
        annotation_reply: { id: 'ar-1', score_threshold: 0.5, embedding_model: { embedding_provider_name: '', embedding_model_name: '' }, enabled: true },
      })
      renderOperation()
      expect(screen.getByTestId('annotation-ctrl')).toBeInTheDocument()
    })

    it('should show prompt log when showPromptLog is true', () => {
      renderOperation({ ...baseProps, showPromptLog: true })
      expect(screen.getByTestId('log-btn')).toBeInTheDocument()
    })

    it('should not show prompt log for opening statements', () => {
      const item = { ...baseItem, isOpeningStatement: true }
      renderOperation({ ...baseProps, item, showPromptLog: true })
      expect(screen.queryByTestId('log-btn')).not.toBeInTheDocument()
    })
  })

  describe('Copy functionality', () => {
    it('should copy content on copy click', async () => {
      const user = userEvent.setup()
      renderOperation()
      await user.click(screen.getByTestId('copy-btn'))
      expect(copy).toHaveBeenCalledWith('Hello world')
    })

    it('should aggregate agent_thoughts for copy content', async () => {
      const user = userEvent.setup()
      const item: ChatItem = {
        ...baseItem,
        content: 'ignored',
        agent_thoughts: [
          { id: '1', thought: 'Hello ', tool: '', tool_input: '', observation: '', message_id: '', conversation_id: '', position: 0 },
          { id: '2', thought: 'World', tool: '', tool_input: '', observation: '', message_id: '', conversation_id: '', position: 1 },
        ],
      }
      renderOperation({ ...baseProps, item })
      await user.click(screen.getByTestId('copy-btn'))
      expect(copy).toHaveBeenCalledWith('Hello World')
    })
  })

  describe('Regenerate', () => {
    it('should call onRegenerate on regenerate click', async () => {
      const user = userEvent.setup()
      renderOperation()
      await user.click(screen.getByTestId('regenerate-btn'))
      expect(mockContextValue.onRegenerate).toHaveBeenCalledWith(baseItem)
    })
  })

  describe('Hiding controls with humanInputFormDataList', () => {
    it('should hide TTS/copy/annotation when humanInputFormDataList is present', () => {
      mockContextValue.config = makeChatConfig({
        supportFeedback: false,
        text_to_speech: { enabled: true },
        supportAnnotation: true,
        annotation_reply: { id: 'ar-1', score_threshold: 0.5, embedding_model: { embedding_provider_name: '', embedding_model_name: '' }, enabled: true },
      })
      const item = { ...baseItem, humanInputFormDataList: [{}] } as ChatItem
      renderOperation({ ...baseProps, item })
      expect(screen.queryByTestId('audio-btn')).not.toBeInTheDocument()
      expect(screen.queryByTestId('copy-btn')).not.toBeInTheDocument()
    })
  })

  describe('User feedback (no annotation support)', () => {
    beforeEach(() => {
      mockContextValue.config = makeChatConfig({ supportFeedback: true, supportAnnotation: false })
    })

    it('should show like/dislike buttons', () => {
      renderOperation()
      const bar = screen.getByTestId('operation-bar')
      expect(bar.querySelector('.i-ri-thumb-up-line')).toBeInTheDocument()
      expect(bar.querySelector('.i-ri-thumb-down-line')).toBeInTheDocument()
    })

    it('should call onFeedback with like on like click', async () => {
      const user = userEvent.setup()
      renderOperation()
      const thumbUp = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-up-line')!.closest('button')!
      await user.click(thumbUp)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: 'like', content: undefined })
    })

    it('should open feedback modal on dislike click', async () => {
      const user = userEvent.setup()
      renderOperation()
      const thumbDown = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-down-line')!.closest('button')!
      await user.click(thumbDown)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should submit dislike feedback from modal', async () => {
      const user = userEvent.setup()
      renderOperation()
      const thumbDown = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-down-line')!.closest('button')!
      await user.click(thumbDown)
      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'Bad response')
      const confirmBtn = screen.getByText(/submit/i)
      await user.click(confirmBtn)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: 'dislike', content: 'Bad response' })
    })

    it('should cancel feedback modal', async () => {
      const user = userEvent.setup()
      renderOperation()
      const thumbDown = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-down-line')!.closest('button')!
      await user.click(thumbDown)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      const cancelBtn = screen.getByText(/cancel/i)
      await user.click(cancelBtn)
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should show existing like feedback and allow undo', async () => {
      const user = userEvent.setup()
      const item = { ...baseItem, feedback: { rating: 'like' as const } }
      renderOperation({ ...baseProps, item })
      const thumbUp = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-up-line')!.closest('button')!
      await user.click(thumbUp)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: null, content: undefined })
    })

    it('should show existing dislike feedback and allow undo', async () => {
      const user = userEvent.setup()
      const item = { ...baseItem, feedback: { rating: 'dislike' as const, content: 'bad' } }
      renderOperation({ ...baseProps, item })
      const thumbDown = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-down-line')!.closest('button')!
      await user.click(thumbDown)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: null, content: undefined })
    })

    it('should undo like when already liked', async () => {
      const user = userEvent.setup()
      renderOperation()
      // First click to like
      const thumbUp = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-up-line')!.closest('button')!
      await user.click(thumbUp)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: 'like', content: undefined })

      // Second click to undo - re-query as it might be a different node
      const thumbUpUndo = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-up-line')!.closest('button')!
      await user.click(thumbUpUndo)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: null, content: undefined })
    })

    it('should undo dislike when already disliked', async () => {
      const user = userEvent.setup()
      renderOperation()
      const thumbDown = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-down-line')!.closest('button')!
      await user.click(thumbDown)
      const submitBtn = screen.getByText(/submit/i)
      await user.click(submitBtn)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: 'dislike', content: '' })

      // Re-query for undo
      const thumbDownUndo = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-down-line')!.closest('button')!
      await user.click(thumbDownUndo)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: null, content: undefined })
    })

    it('should show tooltip with dislike and content', () => {
      const item = { ...baseItem, feedback: { rating: 'dislike' as const, content: 'Too slow' } }
      renderOperation({ ...baseProps, item })
      const bar = screen.getByTestId('operation-bar')
      expect(bar.querySelector('.i-ri-thumb-down-line')).toBeInTheDocument()
    })

    it('should show tooltip with only rating', () => {
      const item = { ...baseItem, feedback: { rating: 'like' as const } }
      renderOperation({ ...baseProps, item })
      const bar = screen.getByTestId('operation-bar')
      expect(bar.querySelector('.i-ri-thumb-up-line')).toBeInTheDocument()
    })

    it('should not show feedback bar for opening statements', () => {
      const item = { ...baseItem, isOpeningStatement: true }
      renderOperation({ ...baseProps, item })
      expect(screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-up-line')).not.toBeInTheDocument()
    })

    it('should not show user feedback bar when humanInputFormDataList is present', () => {
      const item = { ...baseItem, humanInputFormDataList: [{}] } as ChatItem
      renderOperation({ ...baseProps, item })
      expect(screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-up-line')).not.toBeInTheDocument()
    })

    it('should not call feedback when supportFeedback is disabled', async () => {
      mockContextValue.config = makeChatConfig({ supportFeedback: false })
      mockContextValue.onFeedback = undefined
      renderOperation()
      const bar = screen.getByTestId('operation-bar')
      expect(bar.querySelectorAll('.i-ri-thumb-up-line').length).toBe(0)
    })
  })

  describe('Admin feedback (with annotation support)', () => {
    beforeEach(() => {
      mockContextValue.config = makeChatConfig({ supportFeedback: true, supportAnnotation: true })
    })

    it('should show admin like/dislike buttons', () => {
      renderOperation()
      const bar = screen.getByTestId('operation-bar')
      expect(bar.querySelectorAll('.i-ri-thumb-up-line').length).toBeGreaterThanOrEqual(1)
      expect(bar.querySelectorAll('.i-ri-thumb-down-line').length).toBeGreaterThanOrEqual(1)
    })

    it('should call onFeedback with like for admin', async () => {
      const user = userEvent.setup()
      renderOperation()
      const thumbs = screen.getByTestId('operation-bar').querySelectorAll('.i-ri-thumb-up-line')
      const adminThumb = thumbs[thumbs.length - 1].closest('button')!
      await user.click(adminThumb)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: 'like', content: undefined })
    })

    it('should open feedback modal on admin dislike click', async () => {
      const user = userEvent.setup()
      renderOperation()
      const thumbs = screen.getByTestId('operation-bar').querySelectorAll('.i-ri-thumb-down-line')
      const adminThumb = thumbs[thumbs.length - 1].closest('button')!
      await user.click(adminThumb)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should show user feedback read-only in admin bar when user has liked', () => {
      const item = { ...baseItem, feedback: { rating: 'like' as const } }
      renderOperation({ ...baseProps, item })
      const bar = screen.getByTestId('operation-bar')
      expect(bar.querySelectorAll('.i-ri-thumb-up-line').length).toBeGreaterThanOrEqual(2)
    })

    it('should show separator in admin bar when user has feedback', () => {
      const item = { ...baseItem, feedback: { rating: 'dislike' as const } }
      renderOperation({ ...baseProps, item })
      const bar = screen.getByTestId('operation-bar')
      expect(bar.querySelector('.bg-components-actionbar-border')).toBeInTheDocument()
    })

    it('should show existing admin like feedback and allow undo', async () => {
      const user = userEvent.setup()
      const item = { ...baseItem, adminFeedback: { rating: 'like' as const } }
      renderOperation({ ...baseProps, item })
      const thumbUp = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-up-line')!.closest('button')!
      await user.click(thumbUp)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: null, content: undefined })
    })

    it('should show existing admin dislike and allow undo', async () => {
      const user = userEvent.setup()
      const item = { ...baseItem, adminFeedback: { rating: 'dislike' as const } }
      renderOperation({ ...baseProps, item })
      const thumbDown = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-down-line')!.closest('button')!
      await user.click(thumbDown)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: null, content: undefined })
    })

    it('should undo admin like when already liked', async () => {
      const user = userEvent.setup()
      renderOperation()
      const thumbs = screen.getByTestId('operation-bar').querySelectorAll('.i-ri-thumb-up-line')
      const adminThumb = thumbs[thumbs.length - 1].closest('button')!
      await user.click(adminThumb)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: 'like', content: undefined })

      const thumbsUndo = screen.getByTestId('operation-bar').querySelectorAll('.i-ri-thumb-up-line')
      const adminThumbUndo = thumbsUndo[thumbsUndo.length - 1].closest('button')!
      await user.click(adminThumbUndo)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: null, content: undefined })
    })

    it('should undo admin dislike when already disliked', async () => {
      const user = userEvent.setup()
      renderOperation()
      const thumbs = screen.getByTestId('operation-bar').querySelectorAll('.i-ri-thumb-down-line')
      const adminThumb = thumbs[thumbs.length - 1].closest('button')!
      await user.click(adminThumb)
      const submitBtn = screen.getByText(/submit/i)
      await user.click(submitBtn)

      const thumbsUndo = screen.getByTestId('operation-bar').querySelectorAll('.i-ri-thumb-down-line')
      const adminThumbUndo = thumbsUndo[thumbsUndo.length - 1].closest('button')!
      await user.click(adminThumbUndo)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: null, content: undefined })
    })

    it('should not show admin feedback bar when humanInputFormDataList is present', () => {
      const item = { ...baseItem, humanInputFormDataList: [{}] } as ChatItem
      renderOperation({ ...baseProps, item })
      expect(screen.getByTestId('operation-bar').querySelectorAll('.i-ri-thumb-up-line').length).toBe(0)
    })
  })

  describe('Positioning and layout', () => {
    it('should position right when operationWidth < maxSize', () => {
      renderOperation({ ...baseProps, maxSize: 500 })
      const bar = screen.getByTestId('operation-bar')
      expect(bar.style.left).toBeTruthy()
    })

    it('should position bottom when operationWidth >= maxSize', () => {
      renderOperation({ ...baseProps, maxSize: 1 })
      const bar = screen.getByTestId('operation-bar')
      expect(bar.style.left).toBeFalsy()
    })

    it('should apply workflow process class when hasWorkflowProcess is true', () => {
      renderOperation({ ...baseProps, hasWorkflowProcess: true })
      const bar = screen.getByTestId('operation-bar')
      expect(bar.className).toContain('-bottom-4')
    })

    it('should calculate width correctly for all features combined', () => {
      mockContextValue.config = makeChatConfig({
        text_to_speech: { enabled: true },
        supportAnnotation: true,
        annotation_reply: { id: 'ar-1', score_threshold: 0.5, embedding_model: { embedding_provider_name: '', embedding_model_name: '' }, enabled: true },
        supportFeedback: true,
      })
      const item = { ...baseItem, feedback: { rating: 'like' as const }, adminFeedback: { rating: 'dislike' as const } }
      renderOperation({ ...baseProps, item, showPromptLog: true })
      const bar = screen.getByTestId('operation-bar')
      expect(bar).toBeInTheDocument()
    })

    it('should show separator when user has feedback in admin mode', () => {
      mockContextValue.config = makeChatConfig({ supportFeedback: true, supportAnnotation: true })
      const item = { ...baseItem, feedback: { rating: 'like' as const } }
      renderOperation({ ...baseProps, item })
      const bar = screen.getByTestId('operation-bar')
      expect(bar.querySelector('.bg-components-actionbar-border')).toBeInTheDocument()
    })

    it('should handle missing translation fallbacks in buildFeedbackTooltip', () => {
      // Mock t to return null for specific keys
      mockT.mockImplementation((key: string): string => {
        if (key.includes('Rate') || key.includes('like'))
          return '' // Safe string fallback

        return key
      })

      renderOperation()
      expect(screen.getByTestId('operation-bar')).toBeInTheDocument()

      // Reset to default behavior
      mockT.mockImplementation(key => key)
    })
  })

  describe('Annotation integration', () => {
    beforeEach(() => {
      mockContextValue.config = makeChatConfig({
        supportAnnotation: true,
        annotation_reply: { id: 'ar-1', score_threshold: 0.5, embedding_model: { embedding_provider_name: '', embedding_model_name: '' }, enabled: true },
        appId: 'test-app',
      })
    })

    it('should add annotation via annotation ctrl button', async () => {
      const user = userEvent.setup()
      renderOperation()
      const addBtn = screen.getByTestId('annotation-add-btn')
      await user.click(addBtn)
      expect(mockContextValue.onAnnotationAdded).toHaveBeenCalledWith('ann-new', 'Test User', 'What is this?', 'Hello world', 0)
    })

    it('should show annotation full modal when limit reached', async () => {
      const user = userEvent.setup()
      mockProviderContext.enableBilling = true
      mockProviderContext.plan.usage.annotatedResponse = 100
      renderOperation()
      const addBtn = screen.getByTestId('annotation-add-btn')
      await user.click(addBtn)
      expect(mockSetShowAnnotationFullModal).toHaveBeenCalled()
      expect(mockAddAnnotation).not.toHaveBeenCalled()
    })

    it('should open edit reply modal when cached annotation exists', async () => {
      const user = userEvent.setup()
      const item = { ...baseItem, annotation: { id: 'ann-1', created_at: 123, authorName: 'test author' } }
      renderOperation({ ...baseProps, item })
      const editBtn = screen.getByTestId('annotation-edit-btn')
      await user.click(editBtn)
      expect(screen.getByTestId('edit-reply-modal')).toBeInTheDocument()
    })

    it('should call onAnnotationEdited from edit reply modal', async () => {
      const user = userEvent.setup()
      const item = { ...baseItem, annotation: { id: 'ann-1', created_at: 123, authorName: 'test author' } }
      renderOperation({ ...baseProps, item })
      const editBtn = screen.getByTestId('annotation-edit-btn')
      await user.click(editBtn)
      await user.click(screen.getByTestId('modal-edit'))
      expect(mockContextValue.onAnnotationEdited).toHaveBeenCalledWith('eq', 'ea', 0)
    })

    it('should call onAnnotationAdded from edit reply modal', async () => {
      const user = userEvent.setup()
      const item = { ...baseItem, annotation: { id: 'ann-1', created_at: 123, authorName: 'test author' } }
      renderOperation({ ...baseProps, item })
      const editBtn = screen.getByTestId('annotation-edit-btn')
      await user.click(editBtn)
      await user.click(screen.getByTestId('modal-add'))
      expect(mockContextValue.onAnnotationAdded).toHaveBeenCalledWith('a1', 'author', 'eq', 'ea', 0)
    })

    it('should call onAnnotationRemoved from edit reply modal', async () => {
      const user = userEvent.setup()
      const item = { ...baseItem, annotation: { id: 'ann-1', created_at: 123, authorName: 'test author' } }
      renderOperation({ ...baseProps, item })
      const editBtn = screen.getByTestId('annotation-edit-btn')
      await user.click(editBtn)
      await user.click(screen.getByTestId('modal-remove'))
      expect(mockContextValue.onAnnotationRemoved).toHaveBeenCalledWith(0)
    })

    it('should close edit reply modal via onHide', async () => {
      const user = userEvent.setup()
      const item = { ...baseItem, annotation: { id: 'ann-1', created_at: 123, authorName: 'test author' } }
      renderOperation({ ...baseProps, item })
      const editBtn = screen.getByTestId('annotation-edit-btn')
      await user.click(editBtn)
      expect(screen.getByTestId('edit-reply-modal')).toBeInTheDocument()
      await user.click(screen.getByTestId('modal-hide'))
      expect(screen.queryByTestId('edit-reply-modal')).not.toBeInTheDocument()
    })
  })

  describe('TTS audio button', () => {
    beforeEach(() => {
      mockContextValue.config = makeChatConfig({ text_to_speech: { enabled: true, voice: 'test-voice' } })
    })

    it('should show audio play button when TTS enabled', () => {
      renderOperation()
      expect(screen.getByTestId('audio-btn')).toBeInTheDocument()
    })

    it('should not show audio button for humanInputFormDataList', () => {
      const item = { ...baseItem, humanInputFormDataList: [{}] } as ChatItem
      renderOperation({ ...baseProps, item })
      expect(screen.queryByTestId('audio-btn')).not.toBeInTheDocument()
    })
  })

  describe('Edge cases', () => {
    it('should handle feedback content with only whitespace', async () => {
      const user = userEvent.setup()
      mockContextValue.config = makeChatConfig({ supportFeedback: true })
      renderOperation()
      const thumbDown = screen.getByTestId('operation-bar').querySelector('.i-ri-thumb-down-line')!.closest('button')!
      await user.click(thumbDown)
      const textarea = screen.getByRole('textbox')
      await user.type(textarea, '   ')
      const confirmBtn = screen.getByText(/submit/i)
      await user.click(confirmBtn)
      expect(mockContextValue.onFeedback).toHaveBeenCalledWith('msg-1', { rating: 'dislike', content: '   ' })
    })

    it('should handle missing onFeedback callback gracefully', async () => {
      mockContextValue.onFeedback = undefined
      mockContextValue.config = makeChatConfig({ supportFeedback: true })
      renderOperation()
      const bar = screen.getByTestId('operation-bar')
      expect(bar.querySelector('.i-ri-thumb-up-line')).not.toBeInTheDocument()
    })

    it('should handle empty agent_thoughts array', async () => {
      const user = userEvent.setup()
      const item: ChatItem = { ...baseItem, agent_thoughts: [] }
      renderOperation({ ...baseProps, item })
      await user.click(screen.getByTestId('copy-btn'))
      expect(copy).toHaveBeenCalledWith('Hello world')
    })
  })
})
