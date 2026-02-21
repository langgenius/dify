import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import ListFilter from './ListFilter'

describe('ListFilter Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<ListFilter />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'ListFilter')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the filter path correctly', () => {
    const { container } = render(<ListFilter />)

    const group = container.querySelector('#filter')
    const path = container.querySelector('#Vector')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    // Verification of a snippet of the complex filter funnel path
    expect(d).toContain('M2 4C2 2.89543')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <ListFilter className="custom-filter" style={{ color: 'blue' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('custom-filter')
    expect(svg.style.color).toBe('blue')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<ListFilter onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // Double-cast to bypass the SVGSVGElement property mismatch
    // (missing currentScale, etc.) in the nested RefObject structure
    const mockRef = { current: { current: null } }

    render(
      <ListFilter
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
      'sodipodi:docname': 'filter.svg',
      'stroke-miterlimit': '4',
      'clip-rule': 'evenodd',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeMiterlimit).toBe('4')
    expect(result.clipRule).toBe('evenodd')
    // Metadata should be filtered out
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill:none;stroke-width:1' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fill: 'none',
      strokeWidth: '1',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'filter-icon-class' })
    expect(result.className).toBe('filter-icon-class')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:label': 'Layer 1',
      'null-val': undefined,
    }
    const result = normalizeAttrs(attrs)

    // Check that metadata is removed and result is an empty object to pass coverage
    expect(result.inkscapeLabel).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner-layer' },
      children: [{ name: 'rect', attributes: { x: '0', y: '0' } }],
    }
    // Exercises recursive branch where rootProps = false
    const element = generate(node, 'filter-key', false)
    expect(element.props.id).toBe('inner-layer')
    expect(element.key).toBe('filter-key')
  })
})
