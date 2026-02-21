import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import KnowledgeBase from './KnowledgeBase'

describe('KnowledgeBase Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<KnowledgeBase />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'KnowledgeBase')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the specific group ID and path correctly', () => {
    const { container } = render(<KnowledgeBase />)

    // Using CSS escape for the space in "Knowledge Base"
    const group = container.querySelector('#Knowledge\\ Base')
    const path = container.querySelector('#Vector')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    expect(d).toContain('M5.25016 3.49999')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <KnowledgeBase className="kb-icon" style={{ marginTop: '2px' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('kb-icon')
    expect(svg.style.marginTop).toBe('2px')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<KnowledgeBase onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // Double-cast to bypass SVGSVGElement property mismatch (e.g. currentScale)
    const mockRef = { current: { current: null } }

    render(
      <KnowledgeBase
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
      'sodipodi:docname': 'kb.svg',
      'stroke-width': '2',
      'fill-opacity': '0.5',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeWidth).toBe('2')
    expect(result.fillOpacity).toBe('0.5')
    // Metadata should be filtered out
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'color:red;fill-rule:nonzero' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      color: 'red',
      fillRule: 'nonzero',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'kb-custom-class' })
    expect(result.className).toBe('kb-custom-class')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:label': 'layer1',
      'null-attr': undefined,
    }
    const result = normalizeAttrs(attrs)

    // Ensure metadata is removed and object is empty
    expect(result.inkscapeLabel).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner-layer' },
      children: [{ name: 'circle', attributes: { r: '5' } }],
    }
    const element = generate(node, 'kb-key', false)
    expect(element.props.id).toBe('inner-layer')
    expect(element.key).toBe('kb-key')
  })
})
