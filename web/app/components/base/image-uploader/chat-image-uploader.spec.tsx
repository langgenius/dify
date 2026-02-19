import type { useLocalFileUploader } from './hooks'
import type { ImageFile, VisionSettings } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Resolution, TransferMethod } from '@/types/app'
import ChatImageUploader from './chat-image-uploader'

type LocalUploaderArgs = Parameters<typeof useLocalFileUploader>[0]

const mocks = vi.hoisted(() => ({
  hookArgs: undefined as LocalUploaderArgs | undefined,
  handleLocalFileUpload: vi.fn<(file: File) => void>(),
}))

vi.mock('./hooks', () => ({
  useLocalFileUploader: (args: LocalUploaderArgs) => {
    mocks.hookArgs = args
    return {
      disabled: args.disabled ?? false,
      handleLocalFileUpload: mocks.handleLocalFileUpload,
    }
  },
}))

const createSettings = (overrides: Partial<VisionSettings> = {}): VisionSettings => ({
  enabled: true,
  number_limits: 5,
  detail: Resolution.high,
  transfer_methods: [TransferMethod.local_file],
  image_file_size_limit: 10,
  ...overrides,
})

const queryFileInput = () => {
  return screen.queryByTestId('local-file-input') as HTMLInputElement | null
}

const getFileInput = () => {
  const input = queryFileInput()
  if (!input)
    throw new Error('Expected file input to exist')
  return input
}

describe('ChatImageUploader', () => {
  const defaultOnUpload = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hookArgs = undefined
    mocks.handleLocalFileUpload.mockImplementation((file) => {
      mocks.hookArgs?.onUpload({
        type: TransferMethod.local_file,
        _id: 'local-upload-id',
        fileId: '',
        progress: 0,
        url: 'data:image/png;base64,mock',
        file,
      } as ImageFile)
    })
  })

  describe('Rendering', () => {
    it('should render UploadOnlyFromLocal when only local_file transfer method', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      expect(queryFileInput()).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should render UploaderButton when remote_url is a transfer method', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.remote_url],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render UploaderButton when both transfer methods are present', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass limit from image_file_size_limit to uploader hook', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file],
        image_file_size_limit: 20,
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      expect(mocks.hookArgs?.limit).toBe(20)
    })

    it('should convert string image_file_size_limit to number', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file],
        image_file_size_limit: '15',
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      expect(mocks.hookArgs?.limit).toBe(15)
    })

    it('should pass disabled prop in local-only mode', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} disabled />)

      expect(mocks.hookArgs?.disabled).toBe(true)
      expect(getFileInput()).toBeDisabled()
    })

    it('should pass disabled prop in button mode', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.remote_url],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} disabled />)

      expect(screen.getByRole('button')).toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('should call onUpload when a local file is uploaded', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file],
      })
      render(<ChatImageUploader settings={settings} onUpload={onUpload} />)

      const input = getFileInput()
      const file = new File(['hello'], 'demo.png', { type: 'image/png' })
      await user.upload(input, file)

      expect(mocks.handleLocalFileUpload).toHaveBeenCalledWith(file)
      expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({
        type: TransferMethod.local_file,
      }))
    })

    it('should open popover when uploader trigger is clicked', async () => {
      const user = userEvent.setup()
      const settings = createSettings({
        transfer_methods: [TransferMethod.remote_url],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      await user.click(screen.getByRole('button'))

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should call onUpload when a remote image link is submitted', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      const settings = createSettings({
        transfer_methods: [TransferMethod.remote_url],
      })
      render(<ChatImageUploader settings={settings} onUpload={onUpload} />)

      await user.click(screen.getByRole('button'))
      await user.type(screen.getByTestId('image-link-input'), 'https://example.com/image.png')
      await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))

      expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({
        type: TransferMethod.remote_url,
        url: 'https://example.com/image.png',
        progress: 0,
      }))
    })

    it('should not open popover when uploader trigger is disabled', async () => {
      const user = userEvent.setup()
      const settings = createSettings({
        transfer_methods: [TransferMethod.remote_url],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} disabled />)

      await user.click(screen.getByRole('button'))

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should show OR separator and local uploader when both methods are available', async () => {
      const user = userEvent.setup()
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      await user.click(screen.getByRole('button'))

      expect(screen.getByText(/OR/i)).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(queryFileInput()).toBeInTheDocument()
    })

    it('should not show OR separator or local uploader when only remote_url method', async () => {
      const user = userEvent.setup()
      const settings = createSettings({
        transfer_methods: [TransferMethod.remote_url],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      await user.click(screen.getByRole('button'))

      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.queryByText(/OR/i)).not.toBeInTheDocument()
      expect(queryFileInput()).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render UploaderButton for all transfer method', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.all],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render UploaderButton when transfer_methods is empty', () => {
      const settings = createSettings({
        transfer_methods: [],
      })
      render(<ChatImageUploader settings={settings} onUpload={defaultOnUpload} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
