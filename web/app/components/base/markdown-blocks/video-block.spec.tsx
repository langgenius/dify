import { render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'

import VideoGallery from '../video-gallery'
import VideoBlock from './video-block'

type ChildNode = {
  properties?: {
    src?: string
  }
}

type BlockNode = {
  children: ChildNode[]
  properties?: {
    src?: string
  }
}

describe('VideoBlock', () => {
  it('renders multiple video sources from node.children', () => {
    const node: BlockNode = {
      children: [
        { properties: { src: 'a.mp4' } },
        { properties: { src: 'b.mp4' } },
      ],
    }

    render(<VideoBlock node={node} />)

    const video = document.querySelector('video')
    expect(video).toBeTruthy()

    const sources = document.querySelectorAll('source')
    expect(sources).toHaveLength(2)
    expect(sources[0]).toHaveAttribute('src', 'a.mp4')
    expect(sources[1]).toHaveAttribute('src', 'b.mp4')
  })

  it('renders single video from node.properties.src when no children srcs', () => {
    const node: BlockNode = {
      children: [],
      properties: { src: 'single.mp4' },
    }

    render(<VideoBlock node={node} />)

    const sources = document.querySelectorAll('source')
    expect(sources).toHaveLength(1)
    expect(sources[0]).toHaveAttribute('src', 'single.mp4')
  })

  it('returns null when no sources exist', () => {
    const node: BlockNode = {
      children: [],
      properties: {},
    }

    const { container } = render(<VideoBlock node={node} />)

    expect(container.innerHTML).toBe('')
  })

  it('has displayName set', () => {
    expect(VideoBlock.displayName).toBe('VideoBlock')
  })
})

describe('VideoGallery', () => {
  it('returns null when srcs are empty or invalid', () => {
    const { container } = render(<VideoGallery srcs={['', '']} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders video when valid srcs provided', () => {
    render(<VideoGallery srcs={['ok.mp4', 'also.mp4']} />)

    const sources = document.querySelectorAll('source')
    expect(sources).toHaveLength(2)
    expect(sources[0]).toHaveAttribute('src', 'ok.mp4')
    expect(sources[1]).toHaveAttribute('src', 'also.mp4')
  })
})
