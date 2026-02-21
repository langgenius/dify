import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import VariableX from './VariableX'

describe('VariableX Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<VariableX />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'VariableX')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('height', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the variable-x group and the stroke path correctly', () => {
    const { container } = render(<VariableX />)

    // Escaping the slash in the group ID and the parentheses/spaces in the path ID
    const group = container.querySelector('#icons\\/variable-x')
    const path = container.querySelector('#Icon\\ \\(Stroke\\)')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('clip-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')

    // Check path starts with the bracket-like shape coordinates
    const d = path?.getAttribute('d')
    expect(d).toContain('M0.714375 3.42875')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <VariableX className="var-icon" style={{ transform: 'scale(1.2)' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('var-icon')
    expect(svg.style.transform).toBe('scale(1.2)')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<VariableX onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <VariableX
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
      'stroke-width': '1.5',
      'fill-rule': 'evenodd',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeWidth).toBe('1.5')
    expect(result.fillRule).toBe('evenodd')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill:blue;stroke-linecap:round' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fill: 'blue',
      strokeLinecap: 'round',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'variable-style' })
    expect(result.className).toBe('variable-style')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:label': 'icon-layer',
      'custom-prop': undefined,
    }
    const result = normalizeAttrs(attrs)

    expect(result.inkscapeLabel).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner-g' },
      children: [{ name: 'path', attributes: { d: 'M0 0h1v1H0z' } }],
    }
    const element = generate(node, 'var-key', false)
    expect(element.props.id).toBe('inner-g')
    expect(element.key).toBe('var-key')
  })
})
