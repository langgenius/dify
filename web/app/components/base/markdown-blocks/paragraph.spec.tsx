import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Paragraph from './paragraph'

vi.mock('@/app/components/base/image-gallery', () => ({
  default: ({ srcs }: { srcs: string[] }) => (
    <div data-testid="image-gallery">{srcs.join(',')}</div>
  ),
}))

type MockNode = {
  children?: Array<{
    tagName?: string
    properties?: {
      src?: string
    }
  }>
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
})
