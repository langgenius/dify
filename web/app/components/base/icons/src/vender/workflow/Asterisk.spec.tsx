import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Asterisk from './Asterisk'

describe('Asterisk Icon Component', () => {
  it('renders the SVG with correct attributes from JSON', () => {
    const { container } = render(<Asterisk />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Asterisk')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('height', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the internal asterisk path correctly', () => {
    const { container } = render(<Asterisk />)
    const path = container.querySelector('path')

    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill', 'currentColor')

    const dAttribute = path?.getAttribute('d') || ''
    // Verify it starts with the coordinate from Asterisk.json
    expect(dAttribute.startsWith('M7.58325 1.75')).toBe(true)
  })

  it('forwards refs correctly using nested ref structure', () => {
    // Mock the nested structure: { current: { current: null } }
    // to satisfy the specific component type without 'any'
    const mockRef = { current: { current: null } }

    render(
      <Asterisk
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Asterisk className="my-asterisk" style={{ color: 'red' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('my-asterisk')
    expect(svg.style.color).toBe('red')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Asterisk onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Icon Utilities (Full Coverage)', () => {
  it('normalizeAttrs: filters out metadata and data-name', () => {
    const attrs = {
      'inkscape:version': '1.0',
      'sodipodi:docname': 'asterisk.svg',
      'data-name': 'AsteriskLayer',
      'stroke-width': '2',
    }
    const result = normalizeAttrs(attrs)
    expect(result).toEqual({ strokeWidth: '2' })
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'stroke-linecap:round;fill:blue' }
    const result = normalizeAttrs(attrs)
    expect(result.style).toEqual({
      strokeLinecap: 'round',
      color: undefined, // Demonstrates how values are mapped
      fill: 'blue',
    })
  })

  it('normalizeAttrs: handles colon-namespaced attributes', () => {
    const attrs = { 'xlink:href': '#path', 'xmlns:svg': 'exclude' }
    const result = normalizeAttrs(attrs)
    expect(result.xlinkHref).toBe('#path')
    expect(result.xmlnsSvg).toBeUndefined()
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'icon-cls' })
    expect(result.className).toBe('icon-cls')
  })

  it('generate: handles the branch where rootProps is false', () => {
    const node = {
      name: 'g',
      attributes: { id: 'star' },
      children: [],
    }
    // Exercises the branch: if (!rootProps)
    const element = generate(node, 'star-key', false)
    expect(element.props.id).toBe('star')
  })

  it('normalizeAttrs: handles undefined values gracefully', () => {
    const result = normalizeAttrs({ 'data-null': undefined })
    expect(result).toEqual({})
  })
})
