import type { NamedExoticComponent } from 'react'
import { render, screen } from '@testing-library/react'
import * as React from 'react'

// AudioBlock.integration.spec.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AudioBlock from './audio-block'

// Mock the nested AudioPlayer used by AudioGallery (do not mock AudioGallery itself)
const audioPlayerMock = vi.fn()
vi.mock('@/app/components/base/audio-gallery/AudioPlayer', () => ({
  default: (props: { srcs: string[] }) => {
    audioPlayerMock(props)
    return <div data-testid="audio-player" data-srcs={JSON.stringify(props.srcs)} />
  },
})) // adjust path if AudioBlock sits elsewhere

describe('AudioBlock (integration - real AudioGallery)', () => {
  beforeEach(() => {
    audioPlayerMock.mockClear()
  })

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

    const gallery = screen.getByTestId('audio-player')
    expect(gallery).toBeInTheDocument()

    expect(audioPlayerMock).toHaveBeenCalledTimes(1)
    expect(audioPlayerMock).toHaveBeenCalledWith({ srcs: ['one.mp3', 'two.mp3'] })

    expect(container.firstChild).not.toBeNull()
  })

  it('renders AudioGallery with single src from node.properties when no children with properties', () => {
    const node = {
      children: [{ type: 'text', value: 'no-src' }],
      properties: { src: 'single.mp3' },
    }

    render(<AudioBlock node={node} />)

    expect(audioPlayerMock).toHaveBeenCalledTimes(1)
    expect(audioPlayerMock).toHaveBeenCalledWith({ srcs: ['single.mp3'] })
    expect(screen.getByTestId('audio-player')).toBeInTheDocument()
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

  it('has displayName set to AudioBlock', () => {
    const component = AudioBlock as NamedExoticComponent<{ node: unknown }>
    expect(component.displayName).toBe('AudioBlock')
  })
})
