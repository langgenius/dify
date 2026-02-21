import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VideoPreview from './video-preview'

const getOverlay = () => screen.getByTestId('video-preview')
const getCloseButton = () => screen.getByTestId('close-button')
describe('VideoPreview', () => {
  const defaultProps = {
    url: 'https://example.com/video.mp4',
    title: 'Test Video',
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<VideoPreview {...defaultProps} />)

      expect(screen.getByTitle('Test Video')).toBeInTheDocument()
    })

    it('should render video element with controls and preload metadata', () => {
      render(<VideoPreview {...defaultProps} />)

      const video = screen.getByTitle('Test Video')
      expect(video.tagName).toBe('VIDEO')
      expect(video).toHaveAttribute('controls')
      expect(video).toHaveAttribute('preload', 'metadata')
      expect((video as HTMLVideoElement).autoplay).toBe(false)
    })

    it('should render source element with correct src and type', () => {
      render(<VideoPreview {...defaultProps} />)

      const source = screen.getByTitle('Test Video').querySelector('source')
      expect(source).toHaveAttribute('src', 'https://example.com/video.mp4')
      expect(source).toHaveAttribute('type', 'video/mp4')
    })

    it('should render close button', () => {
      render(<VideoPreview {...defaultProps} />)

      expect(getCloseButton()).toBeInTheDocument()
    })

    it('should render via portal into document.body', () => {
      render(<VideoPreview {...defaultProps} />)

      const overlay = getOverlay()
      expect(overlay).toBeInTheDocument()
      expect(overlay.parentElement).toBe(document.body)
    })
  })

  describe('Props', () => {
    it('should set video title from title prop', () => {
      render(<VideoPreview {...defaultProps} title="Demo Video" />)

      expect(screen.getByTitle('Demo Video')).toBeInTheDocument()
    })

    it('should set video source from url prop', () => {
      render(<VideoPreview {...defaultProps} url="https://example.com/demo.mp4" />)

      const source = screen.getByTitle('Test Video').querySelector('source')
      expect(source).toHaveAttribute('src', 'https://example.com/demo.mp4')
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()

      render(<VideoPreview {...defaultProps} onCancel={onCancel} />)

      const closeButton = getCloseButton()
      await user.click(closeButton)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should not call onCancel when overlay is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<VideoPreview {...defaultProps} onCancel={onCancel} />)

      const overlay = getOverlay()
      await user.click(overlay)

      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty url', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      render(<VideoPreview {...defaultProps} url="" />)

      const source = screen.getByTestId('video-element').querySelector('source')
      expect(source).not.toHaveAttribute('src')

      consoleErrorSpy.mockRestore()
    })

    it('should handle empty title', () => {
      render(<VideoPreview {...defaultProps} title="" />)

      const video = screen.getByTestId('video-element')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('title', '')
    })
  })
})
