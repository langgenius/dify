import { fireEvent, render, screen } from '@testing-library/react'
import AudioPreview from './audio-preview'

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

  it('should render close button with icon', () => {
    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={vi.fn()} />)

    const closeIcon = screen.getByTestId('close-btn')
    expect(closeIcon).toBeInTheDocument()
  })

  it('should call onCancel when close button is clicked', () => {
    const onCancel = vi.fn()
    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={onCancel} />)

    const closeIcon = screen.getByTestId('close-btn')
    fireEvent.click(closeIcon.parentElement!)

    expect(onCancel).toHaveBeenCalled()
  })

  it('should stop propagation when backdrop is clicked', () => {
    const { baseElement } = render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={vi.fn()} />)

    const backdrop = baseElement.querySelector('[tabindex="-1"]')
    const event = new MouseEvent('click', { bubbles: true })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    backdrop!.dispatchEvent(event)

    expect(stopPropagation).toHaveBeenCalled()
  })

  it('should call onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn()

    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={onCancel} />)

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    expect(onCancel).toHaveBeenCalled()
  })

  it('should render in a portal attached to document.body', () => {
    render(<AudioPreview url="https://example.com/audio.mp3" title="Test Audio" onCancel={vi.fn()} />)

    const audio = document.querySelector('audio')
    expect(audio?.closest('[tabindex="-1"]')?.parentElement).toBe(document.body)
  })
})
