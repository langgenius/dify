import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import AudioBlock from '../audio-block'

// Mock the nested AudioPlayer used by AudioGallery (do not mock AudioGallery itself)
const audioPlayerMock = vi.fn()
vi.mock('@/app/components/base/audio-gallery/AudioPlayer', () => ({
  default: (props: { srcs: string[] }) => {
    audioPlayerMock(props)
    return null
  },
})) // adjust path if AudioBlock sits elsewhere

describe('AudioBlock source extraction', () => {
  it('renders AudioGallery with multiple srcs extracted from node.children', () => {
    const node = {
      children: [
        { properties: { src: 'one.mp3' } },
        { properties: { src: 'two.mp3' } },
        { type: 'text', value: 'plain' },
      ],
      properties: {},
    }

    render(<AudioBlock node={node} />)

    expect(audioPlayerMock).toHaveBeenCalledWith({ srcs: ['one.mp3', 'two.mp3'] })
  })

  it('renders AudioGallery with single src from node.properties when no children with properties', () => {
    const node = {
      children: [{ type: 'text', value: 'no-src' }],
      properties: { src: 'single.mp3' },
    }

    render(<AudioBlock node={node} />)

    expect(audioPlayerMock).toHaveBeenCalledWith({ srcs: ['single.mp3'] })
  })

  it('returns null when there are no audio sources', () => {
    const node = {
      children: [{ type: 'text', value: 'nothing here' }],
      properties: {},
    }

    const { container } = render(<AudioBlock node={node} />)
    expect(container.firstChild).toBeNull()
    expect(audioPlayerMock).not.toHaveBeenCalled()
  })
})
