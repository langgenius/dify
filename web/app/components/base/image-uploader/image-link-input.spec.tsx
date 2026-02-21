import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import ImageLinkInput from './image-link-input'

describe('ImageLinkInput', () => {
  const defaultProps = {
    onUpload: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ImageLinkInput {...defaultProps} />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render an input with placeholder text', () => {
      render(<ImageLinkInput {...defaultProps} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder')
      expect(input).toHaveAttribute('type', 'text')
    })

    it('should render a submit button', () => {
      render(<ImageLinkInput {...defaultProps} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should disable the button when input is empty', () => {
      render(<ImageLinkInput {...defaultProps} />)
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should disable the button when disabled prop is true', async () => {
      const user = userEvent.setup()
      render(<ImageLinkInput {...defaultProps} disabled />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://example.com/image.png')

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should enable the button when input has text and not disabled', async () => {
      const user = userEvent.setup()
      render(<ImageLinkInput {...defaultProps} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://example.com/image.png')

      expect(screen.getByRole('button')).toBeEnabled()
    })
  })

  describe('User Interactions', () => {
    it('should update input value when typing', async () => {
      const user = userEvent.setup()
      render(<ImageLinkInput {...defaultProps} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://example.com/image.png')

      expect(input).toHaveValue('https://example.com/image.png')
    })

    it('should call onUpload with progress 0 when URL matches http/https/ftp pattern', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      render(<ImageLinkInput onUpload={onUpload} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://example.com/image.png')
      await user.click(screen.getByRole('button'))

      expect(onUpload).toHaveBeenCalledTimes(1)
      expect(onUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransferMethod.remote_url,
          url: 'https://example.com/image.png',
          progress: 0,
          fileId: '',
        }),
      )
    })

    it('should call onUpload with progress -1 when URL does not match pattern', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      render(<ImageLinkInput onUpload={onUpload} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'not-a-valid-url')
      await user.click(screen.getByRole('button'))

      expect(onUpload).toHaveBeenCalledTimes(1)
      expect(onUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          progress: -1,
          url: 'not-a-valid-url',
        }),
      )
    })

    it('should set progress 0 for http:// URLs', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      render(<ImageLinkInput onUpload={onUpload} />)

      await user.type(screen.getByRole('textbox'), 'http://example.com/img.jpg')
      await user.click(screen.getByRole('button'))

      expect(onUpload).toHaveBeenCalledWith(
        expect.objectContaining({ progress: 0 }),
      )
    })

    it('should set progress 0 for ftp:// URLs', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      render(<ImageLinkInput onUpload={onUpload} />)

      await user.type(screen.getByRole('textbox'), 'ftp://files.example.com/img.png')
      await user.click(screen.getByRole('button'))

      expect(onUpload).toHaveBeenCalledWith(
        expect.objectContaining({ progress: 0 }),
      )
    })

    it('should not call onUpload when disabled and button is clicked', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      render(<ImageLinkInput onUpload={onUpload} disabled />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://example.com/image.png')
      await user.click(screen.getByRole('button'))

      // Button is disabled, so click won't fire handleClick
      expect(onUpload).not.toHaveBeenCalled()
    })

    it('should include _id as a timestamp string in the uploaded file', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890)
      render(<ImageLinkInput onUpload={onUpload} />)
      await user.type(screen.getByRole('textbox'), 'https://example.com/img.png')
      await user.click(screen.getByRole('button'))
      expect(onUpload).toHaveBeenCalledWith(
        expect.objectContaining({ _id: '1234567890' }),
      )
      dateNowSpy.mockRestore()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string input without errors', () => {
      render(<ImageLinkInput {...defaultProps} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('')
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should handle URL-like strings without protocol prefix', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      render(<ImageLinkInput onUpload={onUpload} />)

      await user.type(screen.getByRole('textbox'), 'example.com/image.png')
      await user.click(screen.getByRole('button'))

      expect(onUpload).toHaveBeenCalledWith(
        expect.objectContaining({ progress: -1 }),
      )
    })
  })
})
