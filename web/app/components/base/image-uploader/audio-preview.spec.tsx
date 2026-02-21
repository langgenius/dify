import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AudioPreview from './audio-preview'

describe('AudioPreview', () => {
  const defaultProps = {
    url: 'https://example.com/audio.mp3',
    title: 'Test Audio',
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<AudioPreview {...defaultProps} />)
      expect(screen.getByTestId('audio-element')).toBeInTheDocument()
    })

    it('should render audio element with controls', () => {
      render(<AudioPreview {...defaultProps} />)
      const audio = screen.getByTestId('audio-element')
      expect(audio.tagName).toBe('AUDIO')
      expect(audio).toHaveAttribute('controls')
    })

    it('should render source element with correct src', () => {
      render(<AudioPreview {...defaultProps} />)
      const source = screen.getByTestId('audio-element').querySelector('source')
      expect(source).toHaveAttribute('src', 'https://example.com/audio.mp3')
      expect(source).toHaveAttribute('type', 'audio/mpeg')
    })

    it('should render close button', () => {
      render(<AudioPreview {...defaultProps} />)
      const closeBtn = screen.getByTestId('close-preview')
      expect(closeBtn).toBeInTheDocument()
    })

    it('should render via portal into document.body', () => {
      render(<AudioPreview {...defaultProps} />)
      const overlay = screen.getByTestId('audio-preview-overlay')
      expect(overlay).toBeInTheDocument()
      expect(overlay.parentElement).toBe(document.body)
    })
  })

  describe('Props', () => {
    it('should set audio title from title prop', () => {
      render(<AudioPreview {...defaultProps} title="My Song" />)
      expect(screen.getByTitle('My Song')).toBeInTheDocument()
    })

    it('should set audio source from url prop', () => {
      render(<AudioPreview {...defaultProps} url="https://example.com/song.mp3" />)
      const source = screen.getByTestId('audio-element').querySelector('source')
      expect(source).toHaveAttribute('src', 'https://example.com/song.mp3')
    })

    it('should set autoPlay to false', () => {
      render(<AudioPreview {...defaultProps} />)
      const audio = screen.getByTestId('audio-element') as HTMLAudioElement
      expect(audio.autoplay).toBe(false)
    })

    it('should set preload to metadata', () => {
      render(<AudioPreview {...defaultProps} />)
      const audio = screen.getByTestId('audio-element')
      expect(audio).toHaveAttribute('preload', 'metadata')
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<AudioPreview {...defaultProps} onCancel={onCancel} />)

      const closeBtn = screen.getByTestId('close-preview')
      await user.click(closeBtn)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should not call onCancel when overlay background is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<AudioPreview {...defaultProps} onCancel={onCancel} />)

      const overlay = screen.getByTestId('audio-preview-overlay')
      await user.click(overlay)

      // Clicking the overlay backdrop should not trigger onCancel
      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty url', () => {
      render(<AudioPreview {...defaultProps} url="" />)
      const source = screen.getByTestId('audio-element').querySelector('source')
      expect(source).toBeInTheDocument()
    })

    it('should handle empty title', () => {
      render(<AudioPreview {...defaultProps} title="" />)
      const audio = screen.getByTestId('audio-element')
      expect(audio).toBeInTheDocument()
      expect(audio).toHaveAttribute('title', '')
    })
  })
})
