import { render, screen } from '@testing-library/react'
import * as React from 'react'
// AudioGallery.spec.tsx
import { describe, expect, it, vi } from 'vitest'

import AudioGallery from './index'

// Mock AudioPlayer so we only assert prop forwarding
const audioPlayerMock = vi.fn()

vi.mock('./AudioPlayer', () => ({
  default: (props: { srcs: string[] }) => {
    audioPlayerMock(props)
    return <div data-testid="audio-player" />
  },
}))

describe('AudioGallery', () => {
  afterEach(() => {
    audioPlayerMock.mockClear()
    vi.resetModules()
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

  it('filters out falsy srcs and passes valid srcs to AudioPlayer', () => {
    render(<AudioGallery srcs={['a.mp3', '', 'b.mp3']} />)
    expect(screen.getByTestId('audio-player')).toBeInTheDocument()
    expect(audioPlayerMock).toHaveBeenCalledTimes(1)
    expect(audioPlayerMock).toHaveBeenCalledWith({ srcs: ['a.mp3', 'b.mp3'] })
  })

  it('wraps AudioPlayer inside container with expected class', () => {
    const { container } = render(<AudioGallery srcs={['a.mp3']} />)
    const root = container.firstChild as HTMLElement
    expect(root).toBeTruthy()
    expect(root.className).toContain('my-3')
  })
})
