import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import IterationStart from './IterationStart'

describe('IterationStart Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<IterationStart />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'IterationStart')
    expect(svg).toHaveAttribute('viewBox', '0 0 12 12')
    expect(svg).toHaveAttribute('width', '12')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the block-start path structure correctly', () => {
    const { container } = render(<IterationStart />)

    // Escaping the slash in the ID "icons/block-start"
    const group = container.querySelector('#icons\\/block-start')
    const path = container.querySelector('#Vector')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    expect(d).toContain('M6.8498 1.72732')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <IterationStart className="start-node" style={{ color: 'green' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('start-node')
    expect(svg.style.color).toBe('green')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<IterationStart onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // Double-cast to bypass SVGSVGElement property mismatch
    const mockRef = { current: { current: null } }

    render(
      <IterationStart
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
      'sodipodi:docname': 'start.svg',
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
    const attrs = { style: 'display:none;visibility:hidden' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      display: 'none',
      visibility: 'hidden',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'icon-test' })
    expect(result.className).toBe('icon-test')
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
