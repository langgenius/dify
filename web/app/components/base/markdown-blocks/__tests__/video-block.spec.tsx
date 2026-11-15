import { render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vite-plus/test'
import VideoBlock from '../video-block'

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
        {},
        { properties: { src: '' } },
        { properties: { src: 'b.mp4' } },
      ],
    }

    const { container } = render(<VideoBlock node={node} />)

    const sources = container.querySelectorAll('source')
    expect(sources).toHaveLength(2)
    expect(sources[0]).toHaveAttribute('src', 'a.mp4')
    expect(sources[1]).toHaveAttribute('src', 'b.mp4')
  })

  it('renders single video from node.properties.src when no children srcs', () => {
    const node: BlockNode = {
      children: [],
      properties: { src: 'single.mp4' },
    }

    const { container } = render(<VideoBlock node={node} />)

    const sources = container.querySelectorAll('source')
    expect(sources).toHaveLength(1)
    expect(sources[0]).toHaveAttribute('src', 'single.mp4')
  })

  it('returns null when no sources exist', () => {
    const node: BlockNode = {
      children: [],
      properties: {},
    }

    const { container } = render(<VideoBlock node={node} />)

    expect(container).toBeEmptyDOMElement()
  })
})
