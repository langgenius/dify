import type { FileUpload } from '@/app/components/base/features/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { VoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { transcribeAudio } from '@/app/components/base/voice-input/api'
import { startVoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { TransferMethod } from '@/types/app'
import ChatInputArea from '../index'

vi.setConfig({ testTimeout: 60000 })

// ---------------------------------------------------------------------------
// External dependency mocks
// ---------------------------------------------------------------------------

const recorderStop = vi.fn<() => Promise<Blob>>()
const recorderCancel = vi.fn<() => Promise<void>>()
const recorder: VoiceRecorder = {
  analyser: {
    frequencyBinCount: 8,
    getByteFrequencyData: vi.fn(),
  } as unknown as AnalyserNode,
  stop: recorderStop,
  cancel: recorderCancel,
}

vi.mock('@/app/components/base/voice-input/recorder', () => ({
  startVoiceRecorder: vi.fn(),
}))

vi.mock('@/app/components/base/voice-input/api', () => ({ transcribeAudio: vi.fn() }))

vi.stubGlobal(
  'requestAnimationFrame',
  vi.fn(() => 1),
)
vi.stubGlobal('cancelAnimationFrame', vi.fn())
vi.stubGlobal('devicePixelRatio', 1)

// Mock Canvas
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  scale: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  rect: vi.fn(),
  fill: vi.fn(),
  closePath: vi.fn(),
  clearRect: vi.fn(),
  roundRect: vi.fn(),
})
HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
  width: 100,
  height: 50,
})

// ---------------------------------------------------------------------------
// File-uploader store
// ---------------------------------------------------------------------------
const {
  mockFileStore,
  mockIsDragActive,
  mockFeaturesState,
  mockNotify,
  mockIsMultipleLine,
  mockCheckInputsFormResult,
} = vi.hoisted(() => ({
  mockFileStore: {
    files: [] as FileEntity[],
    setFiles: vi.fn(),
  },
  mockIsDragActive: { value: false },
  mockIsMultipleLine: { value: false },
  mockFeaturesState: {
    features: {
      moreLikeThis: { enabled: false },
      opening: { enabled: false },
      moderation: { enabled: false },
      speech2text: { enabled: false },
      text2speech: { enabled: false },
      file: { enabled: false },
      suggested: { enabled: false },
      citation: { enabled: false },
      annotationReply: { enabled: false },
    },
  },
  mockNotify: vi.fn(),
  mockCheckInputsFormResult: { value: true },
}))

vi.mock('@/app/components/base/file-uploader/store', () => ({
  useFileStore: () => ({ getState: () => mockFileStore }),
  useStore: (selector: (s: typeof mockFileStore) => unknown) => selector(mockFileStore),
  FileContextProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))

// ---------------------------------------------------------------------------
// File-uploader hooks
// ---------------------------------------------------------------------------

vi.mock('@/app/components/base/file-uploader/hooks', () => ({
  useFile: () => ({
    handleDragFileEnter: vi.fn(),
    handleDragFileLeave: vi.fn(),
    handleDragFileOver: vi.fn(),
    handleDropFile: vi.fn(),
    handleClipboardPasteFile: vi.fn(),
    isDragActive: mockIsDragActive.value,
  }),
}))

// ---------------------------------------------------------------------------
// Features context mock
// ---------------------------------------------------------------------------

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (s: typeof mockFeaturesState) => unknown) => selector(mockFeaturesState),
}))

// ---------------------------------------------------------------------------
// Toast context
// ---------------------------------------------------------------------------
vi.mock('@langgenius/dify-ui/toast', () => ({
  default: {
    notify: (args: unknown) => mockNotify(args),
  },
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

// ---------------------------------------------------------------------------
// Internal layout hook
// ---------------------------------------------------------------------------

vi.mock('../hooks', () => ({
  useTextAreaHeight: () => ({
    wrapperRef: { current: document.createElement('div') },
    textareaRef: { current: document.createElement('textarea') },
    textValueRef: { current: document.createElement('div') },
    holdSpaceRef: { current: document.createElement('div') },
    handleTextareaResize: vi.fn(),
    get isMultipleLine() {
      return mockIsMultipleLine.value
    },
  }),
}))

// ---------------------------------------------------------------------------
// Input-forms validation hook
// ---------------------------------------------------------------------------
vi.mock('../../check-input-forms-hooks', () => ({
  useCheckInputsForms: () => ({
    checkInputsForm: vi.fn().mockImplementation(() => mockCheckInputsFormResult.value),
  }),
}))

// ---------------------------------------------------------------------------
// Next.js navigation
// ---------------------------------------------------------------------------
vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'test-token' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
}))

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------
const mockVisionConfig: FileUpload = {
  enabled: true,
  fileUploadConfig: {
    image_file_size_limit: 10,
    file_size_limit: 10,
    audio_file_size_limit: 10,
    video_file_size_limit: 10,
    workflow_file_upload_limit: 10,
    batch_count_limit: 0,
    image_file_batch_limit: 0,
    single_chunk_attachment_limit: 0,
    attachment_image_file_size_limit: 0,
    file_upload_limit: 0,
  },
  allowed_file_types: [],
  allowed_file_extensions: [],
  number_limits: 3,
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  image: {
    enabled: true,
    number_limits: 3,
    transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  },
}

const speechToTextTarget = {
  type: 'consoleApp' as const,
  appId: 'app-123',
}

const makeFile = (overrides: Partial<FileEntity> = {}): FileEntity =>
  ({
    id: 'file-1',
    name: 'photo.png',
    type: 'image/png',
    size: 1024,
    progress: 100,
    transferMethod: TransferMethod.local_file,
    uploadedId: 'uploaded-ok',
    ...overrides,
  }) as FileEntity

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getTextarea = () =>
  (screen.queryByPlaceholderText(/inputPlaceholder/i) ||
    screen.queryByPlaceholderText(/inputDisabledPlaceholder/i)) as HTMLTextAreaElement | null

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ChatInputArea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(startVoiceRecorder).mockResolvedValue(recorder)
    recorderStop.mockResolvedValue(new Blob(['mp3-data'], { type: 'audio/mp3' }))
    recorderCancel.mockResolvedValue()
    vi.mocked(transcribeAudio).mockResolvedValue({ text: 'Converted voice text' })
    mockFileStore.files = []
    mockIsDragActive.value = false
    mockIsMultipleLine.value = false
    mockCheckInputsFormResult.value = true
  })

  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render the textarea with default placeholder', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(getTextarea()!).toBeInTheDocument()
    })

    it('should render the readonly placeholder when readonly prop is set', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} readonly />)
      expect(screen.getByPlaceholderText(/inputDisabledPlaceholder/i)).toBeInTheDocument()
    })

    it('should include botName in placeholder text if provided', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} botName="TestBot" />)
      // The i18n pattern shows interpolation: namespace.key:{"botName":"TestBot"}
      expect(getTextarea()!).toHaveAttribute('placeholder', expect.stringContaining('botName'))
    })

    it('should render the custom placeholder when provided', () => {
      render(
        <ChatInputArea visionConfig={mockVisionConfig} customPlaceholder="Ask the assistant" />,
      )
      expect(screen.getByPlaceholderText('Ask the assistant')).toBeInTheDocument()
    })

    it('should fall back to the readonly placeholder when readonly has a custom placeholder', () => {
      render(
        <ChatInputArea
          visionConfig={mockVisionConfig}
          customPlaceholder="Ask the assistant"
          readonly
        />,
      )
      expect(screen.getByPlaceholderText(/inputDisabledPlaceholder/i)).toBeInTheDocument()
    })

    it('should fall back to the default placeholder when custom placeholder is blank', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} customPlaceholder="   " />)
      expect(getTextarea()!).toBeInTheDocument()
    })

    it('should apply disabled styles when the disabled prop is true', () => {
      const { container } = render(<ChatInputArea visionConfig={mockVisionConfig} disabled />)
      expect(container.firstChild).toHaveClass('pointer-events-none', 'opacity-50')
    })

    it('should restore pointer events on the input surface', () => {
      const { container } = render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(container.firstChild).toHaveClass('pointer-events-auto')
    })

    it('should apply drag-active styles when a file is being dragged over', () => {
      mockIsDragActive.value = true
      const { container } = render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(container.querySelector('.border-dashed')).toBeInTheDocument()
    })

    it('should render the send button', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(screen.getByRole('button', { name: 'common.operation.send' })).toBeInTheDocument()
    })

    it('should render a custom send button label when provided', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} sendButtonLabel="Start build" />)
      expect(screen.getByRole('button', { name: 'Start build' })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'common.operation.send' }),
      ).not.toBeInTheDocument()
    })

    it('should render the send button loading state when provided', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      render(
        <ChatInputArea
          visionConfig={mockVisionConfig}
          onSend={onSend}
          sendButtonLabel="Start build"
          sendButtonLoading
        />,
      )

      await user.type(getTextarea()!, 'Build an agent')
      const startBuildButton = screen.getByRole('button', { name: 'Start build' })

      expect(startBuildButton).toHaveAttribute('aria-disabled', 'true')
      expect(startBuildButton.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
      await user.click(startBuildButton)
      expect(onSend).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('User Interaction', () => {
    it('should update textarea value as the user types', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'Hello world')
      expect(textarea).toHaveValue('Hello world')
    })

    it('should clear the textarea after a message is sent', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'Hello world')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

      expect(onSend).toHaveBeenCalled()
      expect(textarea).toHaveValue('')
    })

    it('should keep the textarea when async send is rejected by the owner', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn().mockResolvedValue(false)
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'Keep this message')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

      await waitFor(() => expect(onSend).toHaveBeenCalled())
      expect(textarea).toHaveValue('Keep this message')
    })

    it('should keep the textarea when async send fails', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn().mockRejectedValue(new Error('send failed'))
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'Retry this message')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

      await waitFor(() => expect(onSend).toHaveBeenCalled())
      expect(textarea).toHaveValue('Retry this message')
    })

    it('should call onSend and reset the input when pressing Enter', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'Hello world')
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        code: 'Enter',
        nativeEvent: { isComposing: false },
      })

      expect(onSend).toHaveBeenCalledWith('Hello world', [])
      expect(textarea).toHaveValue('')
    })

    it('should handle pasted text', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.click(textarea)
      await user.paste('Pasted text')

      expect(textarea).toHaveValue('Pasted text')
    })
  })

  // -------------------------------------------------------------------------
  describe('History Navigation', () => {
    it('should navigate back in history with Meta+ArrowUp', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'First{Enter}')
      await user.type(textarea, 'Second{Enter}')

      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}')
      expect(textarea).toHaveValue('Second')

      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}')
      expect(textarea).toHaveValue('First')
    })

    it('should navigate forward in history with Meta+ArrowDown', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'First{Enter}')
      await user.type(textarea, 'Second{Enter}')

      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // Second
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // First
      await user.type(textarea, '{Meta>}{ArrowDown}{/Meta}') // Second

      expect(textarea).toHaveValue('Second')
    })

    it('should clear input when navigating past the end of history', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'First{Enter}')
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // First
      await user.type(textarea, '{Meta>}{ArrowDown}{/Meta}') // empty

      expect(textarea).toHaveValue('')
    })

    it('should NOT navigate history when typing regular text and pressing ArrowUp', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'First{Enter}')
      await user.type(textarea, 'Some text')
      await user.keyboard('{ArrowUp}')

      expect(textarea).toHaveValue('Some text')
    })

    it('should handle ArrowUp when history is empty', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.keyboard('{Meta>}{ArrowUp}{/Meta}')
      expect(textarea).toHaveValue('')
    })

    it('should handle ArrowDown at history boundary', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'First{Enter}')
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // First
      await user.type(textarea, '{Meta>}{ArrowDown}{/Meta}') // empty
      await user.type(textarea, '{Meta>}{ArrowDown}{/Meta}') // still empty

      expect(textarea).toHaveValue('')
    })
  })

  // -------------------------------------------------------------------------
  describe('Voice Input', () => {
    it('should hide the voice input button without an API target', () => {
      render(
        <ChatInputArea speechToTextConfig={{ enabled: true }} visionConfig={mockVisionConfig} />,
      )
      expect(
        screen.queryByRole('button', { name: 'common.voiceInput.start' }),
      ).not.toBeInTheDocument()
    })

    it('should render the voice input button when enabled with an API target', () => {
      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )
      expect(screen.getByRole('button', { name: 'common.voiceInput.start' })).toBeInTheDocument()
    })

    it('should keep the active recorder when the chat input rerenders', async () => {
      const user = userEvent.setup({ delay: null })
      const { rerender } = render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
      await screen.findByRole('button', { name: 'common.voiceInput.stop' })

      rerender(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )

      expect(startVoiceRecorder).toHaveBeenCalledTimes(1)
      expect(recorderCancel).not.toHaveBeenCalled()
    })

    it('should handle stop recording in VoiceInput', async () => {
      const user = userEvent.setup({ delay: null })
      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      await waitFor(() => {
        expect(getTextarea()!).toHaveValue('Converted voice text')
      })
    })

    it('should focus the textarea at the end of converted voice text', async () => {
      const user = userEvent.setup({ delay: null })
      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )
      const textarea = getTextarea()!

      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      await waitFor(() => expect(textarea).toHaveValue('Converted voice text'))
      await waitFor(() => expect(textarea).toHaveFocus())
      expect(textarea.selectionStart).toBe(textarea.value.length)
      expect(textarea.selectionEnd).toBe(textarea.value.length)
    })

    it('should focus the textarea when conversion completes while focus is in the voice input', async () => {
      const user = userEvent.setup({ delay: null })
      let resolveTranscription: ((value: { text: string }) => void) | undefined
      vi.mocked(transcribeAudio).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveTranscription = resolve
        }),
      )
      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )
      const textarea = getTextarea()!

      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))
      const cancelButton = await screen.findByRole('button', { name: 'common.operation.cancel' })
      cancelButton.focus()
      await act(async () => resolveTranscription?.({ text: 'Converted voice text' }))

      await waitFor(() => expect(textarea).toHaveFocus())
      expect(textarea).toHaveValue('Converted voice text')
    })

    it('should preserve focus when the user moves elsewhere during transcription', async () => {
      const user = userEvent.setup({ delay: null })
      let resolveTranscription: ((value: { text: string }) => void) | undefined
      vi.mocked(transcribeAudio).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveTranscription = resolve
        }),
      )
      render(
        <>
          <button type="button">Elsewhere</button>
          <ChatInputArea
            speechToTextConfig={{ enabled: true }}
            speechToTextTarget={speechToTextTarget}
            visionConfig={mockVisionConfig}
          />
        </>,
      )
      const textarea = getTextarea()!
      const elsewhereButton = screen.getByRole('button', { name: 'Elsewhere' })

      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))
      await waitFor(() => expect(transcribeAudio).toHaveBeenCalledTimes(1))
      await user.click(elsewhereButton)
      await act(async () => resolveTranscription?.({ text: 'Converted voice text' }))

      await waitFor(() => expect(textarea).toHaveValue('Converted voice text'))
      expect(elsewhereButton).toHaveFocus()
    })

    it('should wait for the owning draft before transcription', async () => {
      const user = userEvent.setup({ delay: null })
      const onBeforeSpeechToText = vi.fn().mockResolvedValue(undefined)
      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          onBeforeSpeechToText={onBeforeSpeechToText}
          visionConfig={mockVisionConfig}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      await waitFor(() => expect(transcribeAudio).toHaveBeenCalledTimes(1))
      expect(onBeforeSpeechToText).toHaveBeenCalledTimes(1)
      expect(onBeforeSpeechToText.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(transcribeAudio).mock.invocationCallOrder[0]!,
      )
    })

    it('should preserve the current query and report transcription failure', async () => {
      const user = userEvent.setup({ delay: null })
      vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('API error'))
      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )
      const voiceInputButton = screen.getByRole('button', { name: 'common.voiceInput.start' })
      await user.type(getTextarea()!, 'Keep this text')

      await user.click(voiceInputButton)
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.api.actionFailed',
        })
      })
      expect(getTextarea()!).toHaveValue('Keep this text')
      await waitFor(() => expect(voiceInputButton).toHaveFocus())
    })

    it('should restore focus to the voice input trigger when conversion is cancelled', async () => {
      const user = userEvent.setup({ delay: null })
      vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(() => {}))
      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )
      const voiceInputButton = screen.getByRole('button', { name: 'common.voiceInput.start' })

      await user.click(voiceInputButton)
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      const cancelBtn = await screen.findByRole('button', { name: 'common.operation.cancel' })
      await user.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByText(/voiceInput.converting/i)).not.toBeInTheDocument()
      })
      await waitFor(() => expect(voiceInputButton).toHaveFocus())
    })

    it('should restore focus to the voice input trigger when setup is cancelled', async () => {
      const user = userEvent.setup({ delay: null })
      vi.mocked(startVoiceRecorder).mockReturnValueOnce(new Promise(() => {}))
      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )
      const voiceInputButton = screen.getByRole('button', { name: 'common.voiceInput.start' })

      await user.click(voiceInputButton)
      await user.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))

      await waitFor(() => expect(voiceInputButton).toHaveFocus())
    })

    it('should restore focus to the voice input trigger when stopping the recorder fails', async () => {
      const user = userEvent.setup({ delay: null })
      recorderStop.mockRejectedValueOnce(new Error('Recorder failed'))
      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )
      const voiceInputButton = screen.getByRole('button', { name: 'common.voiceInput.start' })

      await user.click(voiceInputButton)
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.api.actionFailed',
        })
      })
      await waitFor(() => expect(voiceInputButton).toHaveFocus())
    })

    it('should preserve focus when the user moves elsewhere before transcription fails', async () => {
      const user = userEvent.setup({ delay: null })
      let rejectTranscription: ((reason?: unknown) => void) | undefined
      vi.mocked(transcribeAudio).mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectTranscription = reject
        }),
      )
      render(
        <>
          <button type="button">Elsewhere</button>
          <ChatInputArea
            speechToTextConfig={{ enabled: true }}
            speechToTextTarget={speechToTextTarget}
            visionConfig={mockVisionConfig}
          />
        </>,
      )
      const elsewhereButton = screen.getByRole('button', { name: 'Elsewhere' })

      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))
      await waitFor(() => expect(transcribeAudio).toHaveBeenCalledTimes(1))
      await user.click(elsewhereButton)
      await act(async () => rejectTranscription?.(new Error('API error')))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.api.actionFailed',
        })
      })
      expect(elsewhereButton).toHaveFocus()
    })

    it('should show error toast when voice permission is denied', async () => {
      const user = userEvent.setup({ delay: null })
      vi.mocked(startVoiceRecorder).mockRejectedValueOnce(
        new DOMException('Permission denied', 'NotAllowedError'),
      )

      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.voiceInput.notAllow',
        })
      })
    })

    it('should show a generic error when voice input setup fails after permission', async () => {
      const user = userEvent.setup({ delay: null })
      vi.mocked(startVoiceRecorder).mockRejectedValueOnce(new Error('AudioWorklet unavailable'))

      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )
      const voiceInputButton = screen.getByRole('button', { name: 'common.voiceInput.start' })

      await user.click(voiceInputButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.api.actionFailed',
        })
      })
      expect(voiceInputButton).toHaveFocus()
    })

    it('should handle empty converted text in VoiceInput', async () => {
      const user = userEvent.setup({ delay: null })
      vi.mocked(transcribeAudio).mockResolvedValueOnce({ text: '' })

      render(
        <ChatInputArea
          speechToTextConfig={{ enabled: true }}
          speechToTextTarget={speechToTextTarget}
          visionConfig={mockVisionConfig}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      await waitFor(() => {
        expect(screen.queryByText(/voiceInput.converting/i)).not.toBeInTheDocument()
      })
      expect(getTextarea()!).toHaveValue('')
    })
  })

  // -------------------------------------------------------------------------
  describe('Validation & Constraints', () => {
    it('should disable send when query is blank', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)

      const sendButton = screen.getByRole('button', { name: 'common.operation.send' })
      expect(sendButton).toBeDisabled()

      await user.click(sendButton)
      expect(onSend).not.toHaveBeenCalled()
      expect(mockNotify).not.toHaveBeenCalled()

      await user.type(getTextarea()!, '   ')
      expect(sendButton).toBeDisabled()
    })

    it('should notify and NOT send while bot is responding', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} isResponding visionConfig={mockVisionConfig} />)

      await user.type(getTextarea()!, 'Hello')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))
      expect(onSend).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    })

    it('should NOT send while file upload is in progress', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      mockFileStore.files = [makeFile({ uploadedId: '', progress: 50 })]

      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      await user.type(getTextarea()!, 'Hello')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

      expect(onSend).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    })

    it('should send successfully with completed file uploads', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      const completedFile = makeFile()
      mockFileStore.files = [completedFile]

      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      await user.type(getTextarea()!, 'Hello')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

      expect(onSend).toHaveBeenCalledWith('Hello', [completedFile])
    })

    it('should handle mixed transfer methods correctly', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      const remoteFile = makeFile({
        id: 'remote',
        transferMethod: TransferMethod.remote_url,
        uploadedId: 'remote-id',
      })
      mockFileStore.files = [remoteFile]

      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      await user.type(getTextarea()!, 'Remote test')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

      expect(onSend).toHaveBeenCalledWith('Remote test', [remoteFile])
    })

    it('should NOT call onSend if checkInputsForm fails', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      mockCheckInputsFormResult.value = false
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)

      await user.type(getTextarea()!, 'Validation fail')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

      expect(onSend).not.toHaveBeenCalled()
    })

    it('should work when onSend prop is missing', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea visionConfig={mockVisionConfig} />)

      await user.type(getTextarea()!, 'No onSend')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))
      // Should not throw
    })
  })

  // -------------------------------------------------------------------------
  describe('Special Keyboard & Composition Events', () => {
    it('should NOT send on Enter if Shift is pressed', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'Hello')
      await user.keyboard('{Shift>}{Enter}{/Shift}')
      expect(onSend).not.toHaveBeenCalled()
    })

    it('should block Enter key during composition', async () => {
      vi.useFakeTimers()
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      fireEvent.compositionStart(textarea)
      fireEvent.change(textarea, { target: { value: 'Composing' } })
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        code: 'Enter',
        nativeEvent: { isComposing: true },
      })

      expect(onSend).not.toHaveBeenCalled()

      fireEvent.compositionEnd(textarea)
      // Wait for the 50ms delay in handleCompositionEnd
      vi.advanceTimersByTime(60)

      fireEvent.keyDown(textarea, {
        key: 'Enter',
        code: 'Enter',
        nativeEvent: { isComposing: false },
      })

      expect(onSend).toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  // -------------------------------------------------------------------------
  describe('Layout & Styles', () => {
    it('should toggle opacity class based on disabled prop', () => {
      const { container, rerender } = render(
        <ChatInputArea visionConfig={mockVisionConfig} disabled={false} />,
      )
      expect(container.firstChild).not.toHaveClass('opacity-50')

      rerender(<ChatInputArea visionConfig={mockVisionConfig} disabled={true} />)
      expect(container.firstChild).toHaveClass('opacity-50')
    })

    it('should handle multi-line layout correctly', () => {
      mockIsMultipleLine.value = true
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      // Send button should still be present
      expect(screen.getByRole('button', { name: 'common.operation.send' })).toBeInTheDocument()
    })

    it('should handle drag enter event on textarea', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!
      fireEvent.dragOver(textarea, { dataTransfer: { types: ['Files'] } })
      // Verify no crash and textarea stays
      expect(textarea).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  describe('Feature Bar', () => {
    it('should render footer notice with an accessible infotip', async () => {
      const user = userEvent.setup({ delay: null })
      const footerNotice = 'Agent runs in a Linux sandbox.'
      const footerNoticeTooltip =
        'For Dify Community Edition, each of your agents runs in a Linux 7.0.0-10060-aws sandbox environment within your docker. Your edits to the environment via Build Chats are persistent.'
      const accessibleName = `common.operation.learnMore: ${footerNotice}`
      render(
        <ChatInputArea
          visionConfig={mockVisionConfig}
          footerNotice={footerNotice}
          footerNoticeTooltip={footerNoticeTooltip}
        />,
      )

      expect(screen.getByText(footerNotice)).toBeInTheDocument()
      expect(screen.queryByText(footerNoticeTooltip)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: accessibleName }))

      expect(await screen.findByText(footerNoticeTooltip)).toBeInTheDocument()
    })

    it('should render feature bar when showFeatureBar is true', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} showFeatureBar />)
      expect(screen.getByText(/feature.bar.empty/i)).toBeTruthy()
    })

    it('should call onFeatureBarClick when clicked', async () => {
      const user = userEvent.setup({ delay: null })
      const onFeatureBarClick = vi.fn()
      render(
        <ChatInputArea
          visionConfig={mockVisionConfig}
          showFeatureBar
          onFeatureBarClick={onFeatureBarClick}
        />,
      )

      await user.click(screen.getByText(/feature.bar.empty/i))
      expect(onFeatureBarClick).toHaveBeenCalledWith(true)
    })

    it('should NOT call onFeatureBarClick when readonly', async () => {
      const user = userEvent.setup({ delay: null })
      const onFeatureBarClick = vi.fn()
      render(
        <ChatInputArea
          visionConfig={mockVisionConfig}
          showFeatureBar
          onFeatureBarClick={onFeatureBarClick}
          readonly
        />,
      )

      await user.click(screen.getByText(/feature.bar.empty/i))
      expect(onFeatureBarClick).not.toHaveBeenCalled()
    })
  })
})
