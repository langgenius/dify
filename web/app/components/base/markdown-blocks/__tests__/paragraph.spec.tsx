import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Paragraph from '../paragraph'

vi.mock('@/app/components/base/image-gallery', () => ({
  default: ({ srcs }: { srcs: string[] }) => (
    <div data-testid="image-gallery">{srcs.join(',')}</div>
  ),
}))

type MockChildNode = {
  tagName?: string
  properties?: { src?: string }
  children?: MockChildNode[]
}

type MockNode = {
  children?: MockChildNode[]
}

type ParagraphProps = {
  node: MockNode
  children?: React.ReactNode
}

const renderParagraph = (props: ParagraphProps) => {
  return render(<Paragraph {...props} />)
}

describe('Paragraph', () => {
  it('should render normal paragraph when no image child exists', () => {
    renderParagraph({
      node: { children: [] },
      children: 'Hello world',
    })

    expect(screen.getByText('Hello world').tagName).toBe('P')
  })

  it('should render image gallery when first child is img', () => {
    renderParagraph({
      node: {
        children: [
          {
            tagName: 'img',
            properties: { src: 'test.png' },
          },
        ],
      },
      children: ['Image only'],
    })

    expect(screen.getByTestId('image-gallery')).toBeInTheDocument()
    expect(screen.getByTestId('image-gallery')).toHaveTextContent('test.png')
  })

  it('should render additional content after image when children length > 1', () => {
    renderParagraph({
      node: {
        children: [
          {
            tagName: 'img',
            properties: { src: 'test.png' },
          },
        ],
      },
      children: ['Image', <span key="1">Caption</span>],
    })

    expect(screen.getByTestId('image-gallery')).toBeInTheDocument()
    expect(screen.getByText('Caption')).toBeInTheDocument()
  })

  it('should render paragraph when first child exists but is not img', () => {
    renderParagraph({
      node: {
        children: [
          {
            tagName: 'div',
          },
        ],
      },
      children: 'Not image',
    })

    expect(screen.getByText('Not image').tagName).toBe('P')
  })

  it('should render paragraph when children_node is undefined', () => {
    renderParagraph({
      node: {},
      children: 'Fallback',
    })

    expect(screen.getByText('Fallback').tagName).toBe('P')
  })

  it('should render div instead of p when image is not the first child', () => {
    renderParagraph({
      node: {
        children: [
          { tagName: 'span' },
          { tagName: 'img', properties: { src: 'test.png' } },
        ],
      },
      children: [<span key="0">Text before</span>, <img key="1" src="test.png" alt="" />],
    })

    const wrapper = screen.getByText('Text before').closest('.markdown-p')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper!.tagName).toBe('DIV')
  })

  it('should render div when image is nested inside a link', () => {
    renderParagraph({
      node: {
        children: [
          {
            tagName: 'a',
            children: [{ tagName: 'img', properties: { src: 'nested.png' } }],
          },
        ],
      },
      children: <a href="#"><img src="nested.png" alt="" /></a>,
    })

    const wrapper = screen.getByRole('link').closest('.markdown-p')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper!.tagName).toBe('DIV')
  })
})
