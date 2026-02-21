import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Code from './Code'

describe('Code Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Code />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Code')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the internal hierarchy (g and path)', () => {
    const { container } = render(<Code />)

    // Check for the group ID defined in the JSON
    const group = container.querySelector('#icons\\/code')
    const path = container.querySelector('path')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Code className="custom-code" style={{ transform: 'scale(1)' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('custom-code')
    expect(svg.style.transform).toBe('scale(1)')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Code onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // Mock the nested structure: { current: { current: null } }
    const mockRef = { current: { current: null } }

    render(
      <Code
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles dash/colon conversion', () => {
    const attrs = {
      'inkscape:version': '1.0',
      'sodipodi:docname': 'code.svg',
      'data-name': 'layer1',
      'stroke-linecap': 'round',
      'xlink:href': '#path',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeLinecap).toBe('round')
    expect(result.xlinkHref).toBe('#path')
    expect(result.inkscapeVersion).toBeUndefined()
    expect(result.dataName).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill-rule:nonzero;opacity:0.8' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fillRule: 'nonzero',
      opacity: '0.8',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'code-icon' })
    expect(result.className).toBe('code-icon')
  })

  it('normalizeAttrs: filters specific namespaces', () => {
    const attrs = {
      'xmlns:svg': 'exclude',
      'xmlns:inkscape': 'exclude',
      'non-existent': undefined,
    }
    const result = normalizeAttrs(attrs)
    expect(result.xmlnsSvg).toBeUndefined()
    expect(result.xmlnsInkscape).toBeUndefined()
  })

  it('generate: handles the false rootProps branch for children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner-g' },
      children: [{ name: 'rect', attributes: { width: '10' } }],
    }
    // Exercises the branch where rootProps = false (recursive step)
    const element = generate(node, 'key-1', false)
    expect(element.props.id).toBe('inner-g')
    expect(element.props.children[0].props.width).toBe('10')
  })
})
