import { fireEvent, render } from '@testing-library/react'
import VideoPreview from './video-preview'

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
}))

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
    const { baseElement } = render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={vi.fn()} />)

    const closeIcon = baseElement.querySelector('svg')
    expect(closeIcon).toBeInTheDocument()
  })

  it('should call onCancel when close button is clicked', () => {
    const onCancel = vi.fn()
    const { baseElement } = render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={onCancel} />)

    const closeIcon = baseElement.querySelector('svg')
    fireEvent.click(closeIcon!.parentElement!)

    expect(onCancel).toHaveBeenCalled()
  })

  it('should stop propagation when backdrop is clicked', () => {
    const { baseElement } = render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={vi.fn()} />)

    const backdrop = baseElement.querySelector('[tabindex="-1"]')
    const event = new MouseEvent('click', { bubbles: true })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    backdrop!.dispatchEvent(event)

    expect(stopPropagation).toHaveBeenCalled()
  })

  it('should register esc hotkey', async () => {
    const { useHotkeys } = vi.mocked(await import('react-hotkeys-hook'))
    const onCancel = vi.fn()

    render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={onCancel} />)

    expect(useHotkeys).toHaveBeenCalledWith('esc', onCancel)
  })

  it('should render in a portal attached to document.body', () => {
    render(<VideoPreview url="https://example.com/video.mp4" title="Test Video" onCancel={vi.fn()} />)

    const video = document.querySelector('video')
    expect(video?.closest('[tabindex="-1"]')?.parentElement).toBe(document.body)
  })
})
