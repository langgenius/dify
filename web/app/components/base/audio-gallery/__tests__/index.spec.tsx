import { render, screen } from '@testing-library/react'
import AudioGallery from '../index'

describe('AudioGallery', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => { })
  })

  it('returns null when srcs array is empty', () => {
    const { container } = render(<AudioGallery srcs={[]} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('audio-player')).toBeNull()
  })

  it('returns null when all srcs are falsy', () => {
    const { container } = render(<AudioGallery srcs={['', '', '']} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('audio-player')).toBeNull()
  })

  it('filters out falsy srcs and renders only valid sources in AudioPlayer', () => {
    render(<AudioGallery srcs={['a.mp3', '', 'b.mp3']} />)
    const audio = screen.getByTestId('audio-player')
    const sources = audio.querySelectorAll('source')

    expect(audio).toBeInTheDocument()
    expect(sources).toHaveLength(2)
    expect(sources[0]?.getAttribute('src')).toBe('a.mp3')
    expect(sources[1]?.getAttribute('src')).toBe('b.mp3')
  })

  it('wraps AudioPlayer inside container with expected class', () => {
    const { container } = render(<AudioGallery srcs={['a.mp3']} />)
    const root = container.firstChild as HTMLElement
    expect(root).toBeTruthy()
    expect(root.className).toContain('my-3')
    expect(screen.getByTestId('audio-player')).toBeInTheDocument()
  })
})
