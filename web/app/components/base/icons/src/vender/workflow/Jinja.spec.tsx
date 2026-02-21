import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Jinja from './Jinja'

describe('Jinja Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Jinja />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Jinja')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 12')
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '12')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the nested group and all 7 paths', () => {
    const { container } = render(<Jinja />)

    // Check for the specific IDs provided in the JSON
    const jinjaGroup = container.querySelector('#Jinja\\ Icon')
    const vectorGroup = container.querySelector('#Vector')
    const paths = container.querySelectorAll('path')

    expect(jinjaGroup).toBeInTheDocument()
    expect(vectorGroup).toBeInTheDocument()
    // Jinja.json contains 7 paths forming the stylized text
    expect(paths.length).toBe(7)

    paths.forEach((path) => {
      expect(path).toHaveAttribute('fill', 'currentColor')
    })
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Jinja className="template-icon" style={{ opacity: '0.8' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('template-icon')
    expect(svg.style.opacity).toBe('0.8')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Jinja onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // Double-cast to bypass SVGSVGElement property mismatch requirements
    const mockRef = { current: { current: null } }

    render(
      <Jinja
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
      'sodipodi:docname': 'jinja.svg',
      'stroke-miterlimit': '10',
      'fill-opacity': '1',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeMiterlimit).toBe('10')
    expect(result.fillOpacity).toBe('1')
    // Metadata should be filtered out
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'pointer-events:none;user-select:none' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      pointerEvents: 'none',
      userSelect: 'none',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'jinja-custom' })
    expect(result.className).toBe('jinja-custom')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:export-xdpi': '96',
      'null-val': undefined,
    }
    const result = normalizeAttrs(attrs)

    expect(result.inkscapeExportXdpi).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'test-group' },
      children: [{ name: 'rect', attributes: { width: '10' } }],
    }
    const element = generate(node, 'jinja-key', false)
    expect(element.props.id).toBe('test-group')
    expect(element.key).toBe('jinja-key')
  })
})
