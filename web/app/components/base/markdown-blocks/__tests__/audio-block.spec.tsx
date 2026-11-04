import { render } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import AudioBlock from '../audio-block'

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

    const { container } = render(<AudioBlock node={node} />)

    expect(
      Array.from(container.querySelectorAll('audio source'), (source) =>
        source.getAttribute('src'),
      ),
    ).toEqual(['one.mp3', 'two.mp3'])
  })

  it('renders AudioGallery with single src from node.properties when no children with properties', () => {
    const node = {
      children: [{ type: 'text', value: 'no-src' }],
      properties: { src: 'single.mp3' },
    }

    const { container } = render(<AudioBlock node={node} />)

    expect(container.querySelector('audio source')).toHaveAttribute('src', 'single.mp3')
  })

  it('returns null when there are no audio sources', () => {
    const node = {
      children: [{ type: 'text', value: 'nothing here' }],
      properties: {},
    }

    const { container } = render(<AudioBlock node={node} />)
    expect(container.firstChild).toBeNull()
  })
})
