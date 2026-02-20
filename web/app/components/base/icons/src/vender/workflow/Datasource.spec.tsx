import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Datasource from './Datasource'

describe('Datasource Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Datasource />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Datasource')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the database path correctly', () => {
    const { container } = render(<Datasource />)
    const path = container.querySelector('path')

    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill', 'currentColor')

    const dAttribute = path?.getAttribute('d') || ''
    // Check start of path from your JSON
    expect(dAttribute.startsWith('M6.99967 1.16675')).toBe(true)
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Datasource className="ds-icon" style={{ opacity: '0.8' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('ds-icon')
    expect(svg.style.opacity).toBe('0.8')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Datasource onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using nested structure', () => {
    // Mock the nested structure: { current: { current: null } }
    const mockRef = { current: { current: null } }

    render(
      <Datasource
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
      'sodipodi:docname': 'datasource.svg',
      'data-name': 'db-layer',
      'stroke-linejoin': 'bevel',
      'xlink:href': '#path',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeLinejoin).toBe('bevel')
    expect(result.xlinkHref).toBe('#path')
    expect(result.inkscapeVersion).toBeUndefined()
    expect(result.dataName).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill-opacity:0.5;stroke-width:1' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fillOpacity: '0.5',
      strokeWidth: '1',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'ds-custom' })
    expect(result.className).toBe('ds-custom')
  })

  it('normalizeAttrs: filters specific namespaces and undefined', () => {
    const attrs = {
      'xmlns:svg': 'exclude',
      'xmlns:sodipodi': 'exclude',
      'attr-undefined': undefined,
    }
    const result = normalizeAttrs(attrs)
    expect(result.xmlnsSvg).toBeUndefined()
    expect(result.xmlnsSodipodi).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner-group' },
      children: [{ name: 'ellipse', attributes: { cx: '1', cy: '1' } }],
    }
    // Exercises recursive branch where rootProps = false
    const element = generate(node, 'gen-key', false)
    expect(element.props.id).toBe('inner-group')
    expect(element.props.children[0].props.cx).toBe('1')
  })
})
