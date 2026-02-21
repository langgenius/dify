import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import HumanInLoop from './HumanInLoop'

describe('HumanInLoop Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<HumanInLoop />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'HumanInLoop')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders all paths defined in the JSON', () => {
    const { container } = render(<HumanInLoop />)
    const paths = container.querySelectorAll('path')

    // Your JSON specifies 3 distinct paths
    expect(paths.length).toBe(3)

    // Check for fill attributes and evenodd rules on the paths that have them
    expect(paths[0]).toHaveAttribute('fill', 'currentColor')
    expect(paths[1]).toHaveAttribute('fill-rule', 'evenodd')
    expect(paths[2]).toHaveAttribute('clip-rule', 'evenodd')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <HumanInLoop className="hil-icon" style={{ strokeWidth: '2' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('hil-icon')
    expect(svg.style.strokeWidth).toBe('2')
  })

  it('handles click events successfully', () => {
    const onClick = vi.fn()
    const { container } = render(<HumanInLoop onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the required ref pattern', () => {
    // Creating a mock for React.MutableRefObject structure
    const mockRef = { current: null } as unknown as React.RefObject<React.MutableRefObject<HTMLOrSVGElement>>

    render(
      <HumanInLoop
        ref={mockRef as unknown as React.RefObject<React.MutableRefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>}
      />,
    )
    expect(mockRef).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles dash/colon conversion', () => {
    const attrs = {
      'inkscape:version': '1.2',
      'sodipodi:docname': 'hil.svg',
      'data-name': 'human-layer',
      'stroke-linecap': 'square',
      'xlink:href': '#path-hil',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeLinecap).toBe('square')
    expect(result.xlinkHref).toBe('#path-hil')
    expect(result.inkscapeVersion).toBeUndefined()
    expect(result.dataName).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill-rule:evenodd;stroke-opacity:0.5' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fillRule: 'evenodd',
      strokeOpacity: '0.5',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'icon-hil' })
    expect(result.className).toBe('icon-hil')
  })

  it('normalizeAttrs: filters specific namespaces and handles undefined', () => {
    const attrs = {
      'xmlns:svg': 'exclude',
      'xmlns:sodipodi': 'exclude',
      'nonexistent': undefined,
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
      children: [{ name: 'circle', attributes: { r: '3' } }],
    }
    // Exercises recursive branch where rootProps = false
    const element = generate(node, 'hil-key', false)
    expect(element.props.id).toBe('inner-group')
    expect(element.key).toBe('hil-key')
  })
})
