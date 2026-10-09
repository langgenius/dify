import type { ReactNode } from 'react'
import type { ExtraProps } from 'streamdown'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import Paragraph from '../paragraph'

vi.mock('@/app/components/base/image-gallery', () => ({
  default: ({ srcs }: { srcs: string[] }) => (
    <div data-testid="image-gallery">{srcs.join(',')}</div>
  ),
}))

const renderParagraph = (
  nodeChildren: NonNullable<ExtraProps['node']>['children'],
  children: ReactNode,
) => {
  const node: NonNullable<ExtraProps['node']> = {
    type: 'element',
    tagName: 'p',
    properties: {},
    children: nodeChildren,
  }
  return render(<Paragraph node={node}>{children}</Paragraph>)
}

describe('Paragraph', () => {
  it('renders a normal paragraph for text and comment nodes', () => {
    renderParagraph(
      [
        { type: 'comment', value: 'A comment' },
        { type: 'text', value: 'Hello world' },
      ],
      'Hello world',
    )

    expect(screen.getByText('Hello world').tagName).toBe('P')
  })

  it('renders the image gallery when the first child is an image', () => {
    renderParagraph(
      [{ type: 'element', tagName: 'img', properties: { src: 'test.png' }, children: [] }],
      ['Image only'],
    )

    expect(screen.getByTestId('image-gallery')).toHaveTextContent('test.png')
  })

  it('preserves additional content after the leading image', () => {
    renderParagraph(
      [{ type: 'element', tagName: 'img', properties: { src: 'test.png' }, children: [] }],
      ['Image', <span key="caption">Caption</span>],
    )

    expect(screen.getByTestId('image-gallery')).toHaveTextContent('test.png')
    expect(screen.getByText('Caption')).toBeInTheDocument()
  })

  it('renders a paragraph when its element children contain no image', () => {
    renderParagraph(
      [{ type: 'element', tagName: 'span', properties: {}, children: [] }],
      'Not image',
    )

    expect(screen.getByText('Not image').tagName).toBe('P')
  })

  it('uses a block wrapper when an image follows text', () => {
    renderParagraph(
      [
        { type: 'text', value: 'Text before' },
        { type: 'element', tagName: 'img', properties: { src: 'test.png' }, children: [] },
      ],
      [<span key="text">Text before</span>, <img key="image" src="test.png" alt="Diagram" />],
    )

    expect(screen.getByText('Text before').parentElement?.tagName).toBe('DIV')
    expect(screen.getByRole('img', { name: 'Diagram' })).toHaveAttribute('src', 'test.png')
  })

  it('uses a block wrapper for an image nested inside a link', () => {
    renderParagraph(
      [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: '#' },
          children: [
            { type: 'element', tagName: 'img', properties: { src: 'nested.png' }, children: [] },
          ],
        },
      ],
      <a href="#">
        <img src="nested.png" alt="Linked diagram" />
      </a>,
    )

    expect(screen.getByRole('link').parentElement?.tagName).toBe('DIV')
    expect(screen.getByRole('img', { name: 'Linked diagram' })).toHaveAttribute('src', 'nested.png')
  })
})
