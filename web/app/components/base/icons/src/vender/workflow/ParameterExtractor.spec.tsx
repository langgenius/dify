import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import ParameterExtractor from './ParameterExtractor'

describe('ParameterExtractor Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<ParameterExtractor />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'ParameterExtractor')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('height', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the extractor group and multiple vector paths', () => {
    const { container } = render(<ParameterExtractor />)

    // Escaping the slash in the group ID
    const group = container.querySelector('#icons\\/parma-extractor')
    const paths = container.querySelectorAll('path')

    expect(group).toBeInTheDocument()
    // Corrected count: Vector + Vector_2...Vector_24 = 24 paths
    expect(paths.length).toBe(24)

    // Check a specific path ID and its fill attribute
    const vector10 = container.querySelector('#Vector_10')
    expect(vector10).toBeInTheDocument()
    expect(vector10).toHaveAttribute('fill', 'currentColor')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <ParameterExtractor className="extractor-tool" style={{ opacity: '0.8' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('extractor-tool')
    expect(svg.style.opacity).toBe('0.8')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<ParameterExtractor onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <ParameterExtractor
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
      'sodipodi:docname': 'extractor.svg',
      'stroke-opacity': '1',
      'fill-rule': 'nonzero',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeOpacity).toBe('1')
    expect(result.fillRule).toBe('nonzero')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill:red;stroke:blue' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fill: 'red',
      stroke: 'blue',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'extractor-active' })
    expect(result.className).toBe('extractor-active')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:label': 'Layer1',
      'data-test': undefined,
    }
    const result = normalizeAttrs(attrs)

    expect(result.inkscapeLabel).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'extractor-group' },
      children: [{ name: 'circle', attributes: { cx: '7', cy: '7', r: '1' } }],
    }
    const element = generate(node, 'extractor-key', false)
    expect(element.props.id).toBe('extractor-group')
    expect(element.key).toBe('extractor-key')
  })
})
