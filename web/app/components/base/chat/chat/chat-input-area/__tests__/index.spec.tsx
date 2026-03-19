import type { FileUpload } from '@/app/components/base/features/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { TransferMethod } from '@/types/app'
import ChatInputArea from '../index'

vi.setConfig({ testTimeout: 60000 })

// ---------------------------------------------------------------------------
// External dependency mocks
// ---------------------------------------------------------------------------

// Track whether getPermission should reject
const { mockGetPermissionConfig } = vi.hoisted(() => ({
  mockGetPermissionConfig: { shouldReject: false },
}))

vi.mock('js-audio-recorder', () => ({
  default: class MockRecorder {
    static getPermission = vi.fn().mockImplementation(() => {
      if (mockGetPermissionConfig.shouldReject) {
        return Promise.reject(new Error('Permission denied'))
      }
      return Promise.resolve(undefined)
    })

    start = vi.fn().mockResolvedValue(undefined)
    stop = vi.fn()
    getWAVBlob = vi.fn().mockReturnValue(new Blob([''], { type: 'audio/wav' }))
    getRecordAnalyseData = vi.fn().mockReturnValue(new Uint8Array(128))
    getChannelData = vi.fn().mockReturnValue({ left: new Float32Array(0), right: new Float32Array(0) })
    getWAV = vi.fn().mockReturnValue(new ArrayBuffer(0))
    destroy = vi.fn()
  },
}))

vi.mock('@/app/components/base/voice-input/utils', () => ({
  convertToMp3: vi.fn().mockReturnValue(new Blob([''], { type: 'audio/mp3' })),
}))

// Mock VoiceInput component - simplified version
vi.mock('@/app/components/base/voice-input', () => {
  const VoiceInputMock = ({
    onCancel,
    onConverted,
  }: {
    onCancel: () => void
    onConverted: (text: string) => void
  }) => {
    // Use module-level state for simplicity
    const [showStop, setShowStop] = React.useState(true)

    const handleStop = () => {
      setShowStop(false)
      // Simulate async conversion
      setTimeout(() => {
        onConverted('Converted voice text')
        setShowStop(true)
      }, 100)
    }

    return (
      <div data-testid="voice-input-mock">
        <div data-testid="voice-input-speaking">voiceInput.speaking</div>
        <div data-testid="voice-input-converting-text">voiceInput.converting</div>
        {showStop && (
          <button data-testid="voice-input-stop" onClick={handleStop}>
            Stop
          </button>
        )}
        <button data-testid="voice-input-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  }

  return {
    default: VoiceInputMock,
  }
})

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16))
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
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

vi.mock('@/service/share', () => ({
  audioToText: vi.fn().mockResolvedValue({ text: 'Converted voice text' }),
  AppSourceType: { webApp: 'webApp', installedApp: 'installedApp' },
}))

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
  useFeatures: (selector: (s: typeof mockFeaturesState) => unknown) =>
    selector(mockFeaturesState),
}))

// ---------------------------------------------------------------------------
// Toast context
// ---------------------------------------------------------------------------
vi.mock('@/app/components/base/toast/context', () => ({
  useToastContext: () => ({ notify: mockNotify, close: vi.fn() }),
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

const makeFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'photo.png',
  type: 'image/png',
  size: 1024,
  progress: 100,
  transferMethod: TransferMethod.local_file,
  uploadedId: 'uploaded-ok',
  ...overrides,
} as FileEntity)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getTextarea = () => (
  screen.queryByPlaceholderText(/inputPlaceholder/i)
  || screen.queryByPlaceholderText(/inputDisabledPlaceholder/i)
) as HTMLTextAreaElement | null

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ChatInputArea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    it('should apply disabled styles when the disabled prop is true', () => {
      const { container } = render(<ChatInputArea visionConfig={mockVisionConfig} disabled />)
      expect(container.firstChild).toHaveClass('opacity-50')
    })

    it('should apply drag-active styles when a file is being dragged over', () => {
      mockIsDragActive.value = true
      const { container } = render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(container.querySelector('.border-dashed')).toBeInTheDocument()
    })

    it('should render the send button', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(screen.getByTestId('send-button')).toBeInTheDocument()
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
      await user.click(screen.getByTestId('send-button'))

      expect(onSend).toHaveBeenCalled()
      expect(textarea).toHaveValue('')
    })

    it('should call onSend and reset the input when pressing Enter', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()!

      await user.type(textarea, 'Hello world')
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', nativeEvent: { isComposing: false } })

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
    it('should render the voice input button when enabled', () => {
      render(<ChatInputArea speechToTextConfig={{ enabled: true }} visionConfig={mockVisionConfig} />)
      expect(screen.getByTestId('voice-input-button')).toBeTruthy()
    })

    it('should handle stop recording in VoiceInput', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea speechToTextConfig={{ enabled: true }} visionConfig={mockVisionConfig} />)

      await user.click(screen.getByTestId('voice-input-button'))
      // Wait for VoiceInput to show speaking
      await screen.findByText(/voiceInput.speaking/i)
      const stopBtn = screen.getByTestId('voice-input-stop')
      await user.click(stopBtn)

      // Converting should show up
      await screen.findByText(/voiceInput.converting/i)

      await waitFor(() => {
        expect(getTextarea()!).toHaveValue('Converted voice text')
      })
    })

    it('should handle cancel in VoiceInput', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea speechToTextConfig={{ enabled: true }} visionConfig={mockVisionConfig} />)

      await user.click(screen.getByTestId('voice-input-button'))
      await screen.findByText(/voiceInput.speaking/i)
      const stopBtn = screen.getByTestId('voice-input-stop')
      await user.click(stopBtn)

      // Wait for converting and cancel button
      const cancelBtn = await screen.findByTestId('voice-input-cancel')
      await user.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByTestId('voice-input-stop')).toBeNull()
      })
    })

    it('should show error toast when voice permission is denied', async () => {
      const user = userEvent.setup({ delay: null })
      mockGetPermissionConfig.shouldReject = true

      render(<ChatInputArea speechToTextConfig={{ enabled: true }} visionConfig={mockVisionConfig} />)

      await user.click(screen.getByTestId('voice-input-button'))

      // Permission denied should trigger error toast
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        )
      })

      mockGetPermissionConfig.shouldReject = false
    })

    it('should handle empty converted text in VoiceInput', async () => {
      const user = userEvent.setup({ delay: null })
      // Mock failure or empty result
      const { audioToText } = await import('@/service/share')
      vi.mocked(audioToText).mockResolvedValueOnce({ text: '' })

      render(<ChatInputArea speechToTextConfig={{ enabled: true }} visionConfig={mockVisionConfig} />)

      await user.click(screen.getByTestId('voice-input-button'))
      await screen.findByText(/voiceInput.speaking/i)
      const stopBtn = screen.getByTestId('voice-input-stop')
      await user.click(stopBtn)

      await waitFor(() => {
        expect(screen.queryByTestId('voice-input-stop')).toBeNull()
      })
      expect(getTextarea()!).toHaveValue('')
    })
  })

  // -------------------------------------------------------------------------
  describe('Validation & Constraints', () => {
    it('should notify and NOT send when query is blank', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)

      await user.click(screen.getByTestId('send-button'))
      expect(onSend).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    })

    it('should notify and NOT send while bot is responding', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} isResponding visionConfig={mockVisionConfig} />)

      await user.type(getTextarea()!, 'Hello')
      await user.click(screen.getByTestId('send-button'))
      expect(onSend).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    })

    it('should NOT send while file upload is in progress', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      mockFileStore.files = [makeFile({ uploadedId: '', progress: 50 })]

      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      await user.type(getTextarea()!, 'Hello')
      await user.click(screen.getByTestId('send-button'))

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
      await user.click(screen.getByTestId('send-button'))

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
      await user.click(screen.getByTestId('send-button'))

      expect(onSend).toHaveBeenCalledWith('Remote test', [remoteFile])
    })

    it('should NOT call onSend if checkInputsForm fails', async () => {
      const user = userEvent.setup({ delay: null })
      const onSend = vi.fn()
      mockCheckInputsFormResult.value = false
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)

      await user.type(getTextarea()!, 'Validation fail')
      await user.click(screen.getByTestId('send-button'))

      expect(onSend).not.toHaveBeenCalled()
    })

    it('should work when onSend prop is missing', async () => {
      const user = userEvent.setup({ delay: null })
      render(<ChatInputArea visionConfig={mockVisionConfig} />)

      await user.type(getTextarea()!, 'No onSend')
      await user.click(screen.getByTestId('send-button'))
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
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', nativeEvent: { isComposing: true } })

      expect(onSend).not.toHaveBeenCalled()

      fireEvent.compositionEnd(textarea)
      // Wait for the 50ms delay in handleCompositionEnd
      vi.advanceTimersByTime(60)

      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', nativeEvent: { isComposing: false } })

      expect(onSend).toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  // -------------------------------------------------------------------------
  describe('Layout & Styles', () => {
    it('should toggle opacity class based on disabled prop', () => {
      const { container, rerender } = render(<ChatInputArea visionConfig={mockVisionConfig} disabled={false} />)
      expect(container.firstChild).not.toHaveClass('opacity-50')

      rerender(<ChatInputArea visionConfig={mockVisionConfig} disabled={true} />)
      expect(container.firstChild).toHaveClass('opacity-50')
    })

    it('should handle multi-line layout correctly', () => {
      mockIsMultipleLine.value = true
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      // Send button should still be present
      expect(screen.getByTestId('send-button')).toBeInTheDocument()
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
