import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Loop from './Loop'

describe('Loop Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Loop />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Loop')
    expect(svg).toHaveAttribute('viewBox', '0 0 18 16')
    expect(svg).toHaveAttribute('width', '18')
    expect(svg).toHaveAttribute('height', '16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the loop path correctly', () => {
    const { container } = render(<Loop />)

    const group = container.querySelector('#loop')
    const path = container.querySelector('#Vector')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('clip-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    // Verifies the infinity/loop shape start point
    expect(d).toContain('M2.02915 5.34506')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Loop className="sync-icon" style={{ strokeWidth: '2px' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('sync-icon')
    expect(svg.style.strokeWidth).toBe('2px')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Loop onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <Loop
        ref={mockRef as unknown as React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles attribute conversion', () => {
    const attrs = {
      'inkscape:version': '1.2',
      'sodipodi:docname': 'loop.svg',
      'fill-rule': 'nonzero',
      'stroke-miterlimit': '4',
    }
    const result = normalizeAttrs(attrs)

    expect(result.fillRule).toBe('nonzero')
    expect(result.strokeMiterlimit).toBe('4')
    // Metadata should be filtered out
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'opacity:0.5;pointer-events:all' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      opacity: '0.5',
      pointerEvents: 'all',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'loop-animation' })
    expect(result.className).toBe('loop-animation')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:connector-curvature': '0',
      'undefined-val': undefined,
    }
    const result = normalizeAttrs(attrs)

    expect(result.inkscapeConnectorCurvature).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'loop-group' },
      children: [{ name: 'circle', attributes: { cx: '5', cy: '5' } }],
    }
    const element = generate(node, 'loop-key', false)
    expect(element.props.id).toBe('loop-group')
    expect(element.key).toBe('loop-key')
  })
})
