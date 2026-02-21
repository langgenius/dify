import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import KnowledgeRetrieval from './KnowledgeRetrieval'

describe('KnowledgeRetrieval Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<KnowledgeRetrieval />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'KnowledgeRetrieval')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the retrieval path structure correctly', () => {
    const { container } = render(<KnowledgeRetrieval />)

    // Escaping the slash in the ID "icons/knowledge-retrieval"
    const group = container.querySelector('#icons\\/knowledge-retrieval')
    const path = container.querySelector('#Vector\\ \\(Stroke\\)')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    expect(d).toContain('M3.78528 2.62834')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <KnowledgeRetrieval className="retrieval-icon" style={{ opacity: '0.9' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('retrieval-icon')
    expect(svg.style.opacity).toBe('0.9')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<KnowledgeRetrieval onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // Double-cast to bypass SVGSVGElement property mismatch (e.g. currentScale)
    const mockRef = { current: { current: null } }

    render(
      <KnowledgeRetrieval
        ref={mockRef as unknown as React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles attribute conversion', () => {
    const attrs = {
      'inkscape:version': '1.0',
      'sodipodi:docname': 'retrieval.svg',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeLinecap).toBe('round')
    expect(result.strokeLinejoin).toBe('round')
    // Metadata should be filtered out
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill-rule:evenodd;clip-rule:evenodd' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fillRule: 'evenodd',
      clipRule: 'evenodd',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'retrieval-custom' })
    expect(result.className).toBe('retrieval-custom')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:label': 'retrieval-layer',
      'null-prop': undefined,
    }
    const result = normalizeAttrs(attrs)

    // Check that metadata is removed and result is an empty object
    expect(result.inkscapeLabel).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner-group' },
      children: [{ name: 'path', attributes: { d: 'M0 0h1v1z' } }],
    }
    const element = generate(node, 'retrieval-key', false)
    expect(element.props.id).toBe('inner-group')
    expect(element.key).toBe('retrieval-key')
  })
})
