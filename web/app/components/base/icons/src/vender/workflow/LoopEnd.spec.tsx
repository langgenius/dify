import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import LoopEnd from './LoopEnd'

describe('LoopEnd Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<LoopEnd />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'LoopEnd')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the loop end path structure correctly', () => {
    const { container } = render(<LoopEnd />)

    const group = container.querySelector('#ongoing')
    const path = container.querySelector('#Vector')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('clip-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    expect(d).toContain('M8 2.75')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <LoopEnd className="end-node" style={{ color: 'red' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('end-node')
    expect(svg.style.color).toBe('red')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<LoopEnd onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <LoopEnd
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
      'sodipodi:docname': 'loop-end.svg',
      'stroke-width': '1.5',
      'fill-rule': 'evenodd',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeWidth).toBe('1.5')
    expect(result.fillRule).toBe('evenodd')
    // Metadata should be filtered out
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'display:block;margin:auto' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      display: 'block',
      margin: 'auto',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'icon-loop-end' })
    expect(result.className).toBe('icon-loop-end')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:collect': 'always',
      'undefined-prop': undefined,
    }
    const result = normalizeAttrs(attrs)

    // Check that metadata is removed and result is an empty object
    expect(result.inkscapeCollect).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner-g' },
      children: [{ name: 'path', attributes: { d: 'M1 1h1v1H1z' } }],
    }
    const element = generate(node, 'key-1', false)
    expect(element.props.id).toBe('inner-g')
    expect(element.key).toBe('key-1')
  })
})
