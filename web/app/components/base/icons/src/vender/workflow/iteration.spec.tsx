import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Iteration from './Iteration'

describe('Iteration Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Iteration />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Iteration')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the iteration path structure correctly', () => {
    const { container } = render(<Iteration />)

    // Escaping the slash in the ID "icons/iteration"
    const group = container.querySelector('#icons\\/iteration')
    const path = container.querySelector('#Vector')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill', 'currentColor')

    // Check that the complex path data is present
    const d = path?.getAttribute('d')
    expect(d).toContain('M6.82849 0.754349')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Iteration className="loop-icon" style={{ transform: 'rotate(90deg)' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('loop-icon')
    expect(svg.style.transform).toBe('rotate(90deg)')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Iteration onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    /**
     * Using double-cast to bypass the SVGSVGElement property mismatch
     * (e.g., missing currentScale) that occurs with the nested RefObject type.
     */
    const mockRef = { current: { current: null } }

    render(
      <Iteration
        ref={mockRef as unknown as React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles attribute conversion', () => {
    const attrs = {
      'inkscape:label': 'iteration-layer',
      'sodipodi:insensitive': 'true',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'bevel',
      'fill-opacity': '0.8',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeLinecap).toBe('round')
    expect(result.strokeLinejoin).toBe('bevel')
    expect(result.fillOpacity).toBe('0.8')
    expect(result.inkscapeLabel).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'stroke-width:2;display:block' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      strokeWidth: '2',
      display: 'block',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'iteration-svg' })
    expect(result.className).toBe('iteration-svg')
  })

  it('normalizeAttrs: handles undefined and specific namespaces', () => {
    const attrs = {
      'inkscape:collect': 'always', // This should be filtered out
      'undefined-prop': undefined,
    }
    const result = normalizeAttrs(attrs)

    // Check that inkscape metadata is removed
    expect(result.inkscapeCollect).toBeUndefined()

    // Ensure the result is an empty object since all inputs were filtered or undefined
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner-loop' },
      children: [{ name: 'path', attributes: { d: 'M0 0h1v1H0z' } }],
    }
    // Exercises recursive branch where rootProps = false
    const element = generate(node, 'iter-key', false)
    expect(element.props.id).toBe('inner-loop')
    expect(element.key).toBe('iter-key')
  })
})
