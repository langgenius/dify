import { fireEvent, render, screen } from '@testing-library/react'
import AudioPreview from './audio-preview'

vi.mock('@remixicon/react', () => ({
  RiCloseLine: ({ className }: { className?: string }) => (
    <svg data-testid="close-icon" className={className} />
  ),
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
}))

describe('AudioPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render audio element with correct source', () => {
    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={vi.fn()} />)

    const audio = document.querySelector('audio')
    expect(audio).toBeInTheDocument()
    expect(audio).toHaveAttribute('title', 'Test Audio')
  })

  it('should render source element with correct src and type', () => {
    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={vi.fn()} />)

    const source = document.querySelector('source')
    expect(source).toHaveAttribute('src', 'https://example.com/audio.mp3')
    expect(source).toHaveAttribute('type', 'audio/mpeg')
  })

  it('should render close button', () => {
    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={vi.fn()} />)

    expect(screen.getByTestId('close-icon')).toBeInTheDocument()
  })

  it('should call onCancel when close button is clicked', () => {
    const onCancel = vi.fn()
    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={onCancel} />)

    const closeButton = screen.getByTestId('close-icon').closest('div[class*="cursor-pointer"]')
    fireEvent.click(closeButton!)

    expect(onCancel).toHaveBeenCalled()
  })

  it('should stop propagation when backdrop is clicked', () => {
    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={vi.fn()} />)

    const backdrop = document.querySelector('.fixed.inset-0')
    const event = new MouseEvent('click', { bubbles: true })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    backdrop!.dispatchEvent(event)

    expect(stopPropagation).toHaveBeenCalled()
  })

  it('should register esc hotkey', async () => {
    const { useHotkeys } = vi.mocked(await import('react-hotkeys-hook'))
    const onCancel = vi.fn()

    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={onCancel} />)

    expect(useHotkeys).toHaveBeenCalledWith('esc', onCancel)
  })

  it('should render in a portal attached to document.body', () => {
    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={vi.fn()} />)

    const backdrop = document.querySelector('.fixed.inset-0')
    expect(backdrop?.parentElement).toBe(document.body)
  })
})
