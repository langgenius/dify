import type { FileUpload } from '@/app/components/base/features/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { TransferMethod } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { vi } from 'vitest'
import ChatInputArea from './index'

// ---------------------------------------------------------------------------
// Hoist shared mock references so they are available inside vi.mock factories
// ---------------------------------------------------------------------------
const { mockGetPermission, mockNotify } = vi.hoisted(() => ({
  mockGetPermission: vi.fn().mockResolvedValue(undefined),
  mockNotify: vi.fn(),
}))

// ---------------------------------------------------------------------------
// External dependency mocks
// ---------------------------------------------------------------------------

vi.mock('js-audio-recorder', () => ({
  default: class {
    static getPermission = mockGetPermission
    start = vi.fn()
    stop = vi.fn()
    getWAVBlob = vi.fn().mockReturnValue(new Blob([''], { type: 'audio/wav' }))
    getRecordAnalyseData = vi.fn().mockReturnValue(new Uint8Array(128))
  },
}))

vi.mock('@/service/share', () => ({
  audioToText: vi.fn().mockResolvedValue({ text: 'Converted text' }),
  AppSourceType: { webApp: 'webApp', installedApp: 'installedApp' },
}))

// ---------------------------------------------------------------------------
// File-uploader store – shared mutable state so individual tests can mutate it
// ---------------------------------------------------------------------------
const mockFileStore: { files: FileEntity[], setFiles: ReturnType<typeof vi.fn> } = {
  files: [],
  setFiles: vi.fn(),
}

vi.mock('@/app/components/base/file-uploader/store', () => ({
  useFileStore: () => ({ getState: () => mockFileStore }),
  useStore: (selector: (s: typeof mockFileStore) => unknown) => selector(mockFileStore),
  FileContextProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))

// ---------------------------------------------------------------------------
// File-uploader hooks – provide stable drag/drop handlers
// ---------------------------------------------------------------------------
vi.mock('@/app/components/base/file-uploader/hooks', () => ({
  useFile: () => ({
    handleDragFileEnter: vi.fn(),
    handleDragFileLeave: vi.fn(),
    handleDragFileOver: vi.fn(),
    handleDropFile: vi.fn(),
    handleClipboardPasteFile: vi.fn(),
    isDragActive: false,
  }),
}))

// ---------------------------------------------------------------------------
// Features context hook – avoids needing FeaturesContext.Provider in the tree
// ---------------------------------------------------------------------------
// FeatureBar calls: useFeatures(s => s.features)
// So the selector receives the store state object; we must nest the features
// under a `features` key to match what the real store exposes.
const mockFeaturesState = {
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
}

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (s: typeof mockFeaturesState) => unknown) =>
    selector(mockFeaturesState),
}))

// ---------------------------------------------------------------------------
// Toast context
// ---------------------------------------------------------------------------
vi.mock('@/app/components/base/toast', async () => {
  const actual = await vi.importActual<typeof import('@/app/components/base/toast')>(
    '@/app/components/base/toast',
  )
  return {
    ...actual,
    useToastContext: () => ({ notify: mockNotify }),
  }
})

// ---------------------------------------------------------------------------
// Internal layout hook – controls single/multi-line textarea mode
// ---------------------------------------------------------------------------
let mockIsMultipleLine = false

vi.mock('./hooks', () => ({
  useTextAreaHeight: () => ({
    wrapperRef: { current: document.createElement('div') },
    textareaRef: { current: document.createElement('textarea') },
    textValueRef: { current: document.createElement('div') },
    holdSpaceRef: { current: document.createElement('div') },
    handleTextareaResize: vi.fn(),
    get isMultipleLine() {
      return mockIsMultipleLine
    },
  }),
}))

// ---------------------------------------------------------------------------
// Input-forms validation hook – always passes by default
// ---------------------------------------------------------------------------
vi.mock('../check-input-forms-hooks', () => ({
  useCheckInputsForms: () => ({
    checkInputsForm: vi.fn().mockReturnValue(true),
  }),
}))

// ---------------------------------------------------------------------------
// Next.js navigation
// ---------------------------------------------------------------------------
vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'test-token' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
}))

// ---------------------------------------------------------------------------
// Shared fixture – typed as FileUpload to avoid implicit any
// ---------------------------------------------------------------------------
// const mockVisionConfig: FileUpload = {
//   fileUploadConfig: {
//     image_file_size_limit: 10,
//     file_size_limit: 10,
//     audio_file_size_limit: 10,
//     video_file_size_limit: 10,
//     workflow_file_upload_limit: 10,
//   },
//   allowed_file_types: [],
//   allowed_file_extensions: [],
//   enabled: true,
//   number_limits: 3,
//   transfer_methods: ['local_file', 'remote_url'],
// } as FileUpload

const mockVisionConfig: FileUpload = {
  // Required because of '& EnabledOrDisabled' at the end of your type
  enabled: true,

  // The nested config object
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

  // These match the keys in your FileUpload type
  allowed_file_types: [],
  allowed_file_extensions: [],
  number_limits: 3,

  // NOTE: Your type defines 'allowed_file_upload_methods',
  // not 'transfer_methods' at the top level.
  allowed_file_upload_methods: ['local_file', 'remote_url'] as TransferMethod[],

  // If you wanted to define specific image/video behavior:
  image: {
    enabled: true,
    number_limits: 3,
    transfer_methods: ['local_file', 'remote_url'] as TransferMethod[],
  },
}

// ---------------------------------------------------------------------------
// Minimal valid FileEntity fixture – avoids undefined `type` crash in FileItem
// ---------------------------------------------------------------------------
const makeFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'photo.png',
  type: 'image/png', // required: FileItem calls type.split('/')[0]
  size: 1024,
  progress: 100,
  transferMethod: 'local_file',
  uploadedId: 'uploaded-ok',
  ...overrides,
} as FileEntity)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getTextarea = () => screen.getByPlaceholderText(/inputPlaceholder/i)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ChatInputArea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFileStore.files = []
    mockIsMultipleLine = false
  })

  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render the textarea with default placeholder', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(getTextarea()).toBeInTheDocument()
    })

    it('should render the readonly placeholder when readonly prop is set', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} readonly />)
      expect(screen.getByPlaceholderText(/inputDisabledPlaceholder/i)).toBeInTheDocument()
    })

    it('should render the send button', () => {
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(screen.getByTestId('send-button')).toBeInTheDocument()
    })

    it('should apply disabled styles when the disabled prop is true', () => {
      const { container } = render(<ChatInputArea visionConfig={mockVisionConfig} disabled />)
      const disabledWrapper = container.querySelector('.pointer-events-none')
      expect(disabledWrapper).toBeInTheDocument()
    })

    it('should render the operation section inline when single-line', () => {
      // mockIsMultipleLine is false by default
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(screen.getByTestId('send-button')).toBeInTheDocument()
    })

    it('should render the operation section below the textarea when multi-line', () => {
      mockIsMultipleLine = true
      render(<ChatInputArea visionConfig={mockVisionConfig} />)
      expect(screen.getByTestId('send-button')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  describe('Typing', () => {
    it('should update textarea value as the user types', async () => {
      const user = userEvent.setup()
      render(<ChatInputArea visionConfig={mockVisionConfig} />)

      await user.type(getTextarea(), 'Hello world')

      expect(getTextarea()).toHaveValue('Hello world')
    })

    it('should clear the textarea after a message is successfully sent', async () => {
      const user = userEvent.setup()
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)

      await user.type(getTextarea(), 'Hello world')
      await user.click(screen.getByTestId('send-button'))

      expect(getTextarea()).toHaveValue('')
    })
  })

  // -------------------------------------------------------------------------
  describe('Sending Messages', () => {
    it('should call onSend with query and files when clicking the send button', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)

      await user.type(getTextarea(), 'Hello world')
      await user.click(screen.getByTestId('send-button'))

      expect(onSend).toHaveBeenCalledTimes(1)
      expect(onSend).toHaveBeenCalledWith('Hello world', [])
    })

    it('should call onSend and reset the input when pressing Enter', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)

      await user.type(getTextarea(), 'Hello world{Enter}')

      expect(onSend).toHaveBeenCalledWith('Hello world', [])
      expect(getTextarea()).toHaveValue('')
    })

    it('should NOT call onSend when pressing Shift+Enter (inserts newline instead)', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)

      await user.type(getTextarea(), 'Hello world{Shift>}{Enter}{/Shift}')

      expect(onSend).not.toHaveBeenCalled()
      expect(getTextarea()).toHaveValue('Hello world\n')
    })

    it('should NOT call onSend in readonly mode', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} readonly />)

      await user.click(screen.getByTestId('send-button'))

      expect(onSend).not.toHaveBeenCalled()
    })

    it('should pass already-uploaded files to onSend', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()

      // makeFile ensures `type` is always a proper MIME string
      const uploadedFile = makeFile({ id: 'file-1', name: 'photo.png', uploadedId: 'uploaded-123' })
      mockFileStore.files = [uploadedFile]

      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      await user.type(getTextarea(), 'With attachment')
      await user.click(screen.getByTestId('send-button'))

      expect(onSend).toHaveBeenCalledWith('With attachment', [uploadedFile])
    })
  })

  // -------------------------------------------------------------------------
  describe('History Navigation', () => {
    it('should restore the last sent message when pressing Cmd+ArrowUp once', async () => {
      const user = userEvent.setup()
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()

      await user.type(textarea, 'First{Enter}')
      await user.type(textarea, 'Second{Enter}')
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}')

      expect(textarea).toHaveValue('Second')
    })

    it('should go further back in history with repeated Cmd+ArrowUp', async () => {
      const user = userEvent.setup()
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()

      await user.type(textarea, 'First{Enter}')
      await user.type(textarea, 'Second{Enter}')
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}')
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}')

      expect(textarea).toHaveValue('First')
    })

    it('should move forward in history when pressing Cmd+ArrowDown', async () => {
      const user = userEvent.setup()
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()

      await user.type(textarea, 'First{Enter}')
      await user.type(textarea, 'Second{Enter}')
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // → Second
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // → First
      await user.type(textarea, '{Meta>}{ArrowDown}{/Meta}') // → Second

      expect(textarea).toHaveValue('Second')
    })

    it('should clear the input when navigating past the most recent history entry', async () => {
      const user = userEvent.setup()
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()

      await user.type(textarea, 'First{Enter}')
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // → First
      await user.type(textarea, '{Meta>}{ArrowDown}{/Meta}') // → past end → ''

      expect(textarea).toHaveValue('')
    })

    it('should not go below the start of history when pressing Cmd+ArrowUp at the boundary', async () => {
      const user = userEvent.setup()
      render(<ChatInputArea onSend={vi.fn()} visionConfig={mockVisionConfig} />)
      const textarea = getTextarea()

      await user.type(textarea, 'Only{Enter}')
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // → Only
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // → '' (seed at index 0)
      await user.type(textarea, '{Meta>}{ArrowUp}{/Meta}') // boundary – should stay at ''

      expect(textarea).toHaveValue('')
    })
  })

  // -------------------------------------------------------------------------
  describe('Voice Input', () => {
    it('should render the voice input button when speech-to-text is enabled', () => {
      render(<ChatInputArea speechToTextConfig={{ enabled: true }} visionConfig={mockVisionConfig} />)
      expect(screen.getByTestId('voice-input-button')).toBeInTheDocument()
    })

    it('should NOT render the voice input button when speech-to-text is disabled', () => {
      render(<ChatInputArea speechToTextConfig={{ enabled: false }} visionConfig={mockVisionConfig} />)
      expect(screen.queryByTestId('voice-input-button')).not.toBeInTheDocument()
    })

    it('should request microphone permission when the voice button is clicked', async () => {
      const user = userEvent.setup()
      render(<ChatInputArea speechToTextConfig={{ enabled: true }} visionConfig={mockVisionConfig} />)

      await user.click(screen.getByTestId('voice-input-button'))

      expect(mockGetPermission).toHaveBeenCalledTimes(1)
    })

    it('should notify with an error when microphone permission is denied', async () => {
      const user = userEvent.setup()
      mockGetPermission.mockRejectedValueOnce(new Error('Permission denied'))
      render(<ChatInputArea speechToTextConfig={{ enabled: true }} visionConfig={mockVisionConfig} />)

      await user.click(screen.getByTestId('voice-input-button'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      })
    })

    it('should NOT invoke onSend while voice input is being activated', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(
        <ChatInputArea
          onSend={onSend}
          speechToTextConfig={{ enabled: true }}
          visionConfig={mockVisionConfig}
        />,
      )

      await user.click(screen.getByTestId('voice-input-button'))

      expect(onSend).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('Validation', () => {
    it('should notify and NOT call onSend when the query is blank', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)

      await user.click(screen.getByTestId('send-button'))

      expect(onSend).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    })

    it('should notify and NOT call onSend when the query contains only whitespace', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)

      await user.type(getTextarea(), '   ')
      await user.click(screen.getByTestId('send-button'))

      expect(onSend).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    })

    it('should notify and NOT call onSend while the bot is already responding', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      render(<ChatInputArea onSend={onSend} isResponding visionConfig={mockVisionConfig} />)

      await user.type(getTextarea(), 'Hello')
      await user.click(screen.getByTestId('send-button'))

      expect(onSend).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    })

    it('should notify and NOT call onSend while a file upload is still in progress', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()

      // uploadedId is empty string → upload not yet finished
      mockFileStore.files = [
        makeFile({ id: 'file-upload', uploadedId: '', progress: 50 }),
      ]

      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      await user.type(getTextarea(), 'Hello')
      await user.click(screen.getByTestId('send-button'))

      expect(onSend).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    })

    it('should call onSend normally when all uploaded files have completed', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()

      // uploadedId is present → upload finished
      mockFileStore.files = [makeFile({ uploadedId: 'uploaded-ok' })]

      render(<ChatInputArea onSend={onSend} visionConfig={mockVisionConfig} />)
      await user.type(getTextarea(), 'With completed file')
      await user.click(screen.getByTestId('send-button'))

      expect(onSend).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  describe('Feature Bar', () => {
    it('should render the FeatureBar section when showFeatureBar is true', () => {
      const { container } = render(
        <ChatInputArea visionConfig={mockVisionConfig} showFeatureBar />,
      )
      // FeatureBar renders a rounded-bottom container beneath the input
      expect(container.querySelector('[class*="rounded-b"]')).toBeInTheDocument()
    })

    it('should NOT render the FeatureBar when showFeatureBar is false', () => {
      const { container } = render(
        <ChatInputArea visionConfig={mockVisionConfig} showFeatureBar={false} />,
      )
      expect(container.querySelector('[class*="rounded-b"]')).not.toBeInTheDocument()
    })

    it('should not invoke onFeatureBarClick when the component is in readonly mode', async () => {
      const user = userEvent.setup()
      const onFeatureBarClick = vi.fn()
      render(
        <ChatInputArea
          visionConfig={mockVisionConfig}
          showFeatureBar
          readonly
          onFeatureBarClick={onFeatureBarClick}
        />,
      )

      // In readonly mode the FeatureBar receives `noop` as its click handler.
      // Click every button that is not a named test-id button to exercise the guard.
      const buttons = screen.queryAllByRole('button')
      for (const btn of buttons) {
        if (!btn.dataset.testid)
          await user.click(btn)
      }

      expect(onFeatureBarClick).not.toHaveBeenCalled()
    })
  })
})
