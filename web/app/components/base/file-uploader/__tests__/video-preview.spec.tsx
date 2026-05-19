import { fireEvent, render, screen } from '@testing-library/react'
import VideoPreview from '../video-preview'

describe('VideoPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render video element with correct title', () => {
    render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={vi.fn()} />)

    const video = document.querySelector('video')
    expect(video).toBeInTheDocument()
    expect(video).toHaveAttribute('title', 'Test Video')
  })

  it('should render source element with correct src and type', () => {
    render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={vi.fn()} />)

    const source = document.querySelector('source')
    expect(source).toHaveAttribute('src', 'https://example.com/video.mp4')
    expect(source).toHaveAttribute('type', 'video/mp4')
  })

  it('should render close button with icon', () => {
    render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
  })

  it('should call onCancel when close button is clicked', () => {
    const onCancel = vi.fn()
    render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('should not close when backdrop is clicked', () => {
    const onCancel = vi.fn()
    render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={onCancel} />)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('should call onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn()

    render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={onCancel} />)

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    expect(onCancel).toHaveBeenCalled()
  })

  it('should render in a portal attached to document.body', () => {
    render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={vi.fn()} />)

    const video = document.querySelector('video')
    expect(video?.closest('[data-base-ui-portal]')?.parentElement).toBe(document.body)
  })
})
