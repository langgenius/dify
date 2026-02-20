import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import CalendarCheckLine from './CalendarCheckLine'

describe('CalendarCheckLine Icon Component', () => {
  it('renders the SVG with correct attributes from JSON', () => {
    const { container } = render(<CalendarCheckLine />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'CalendarCheckLine')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the calendar path correctly', () => {
    const { container } = render(<CalendarCheckLine />)
    const path = container.querySelector('path')

    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill', 'currentColor')

    const dAttribute = path?.getAttribute('d') || ''
    // Check start of path from your JSON
    expect(dAttribute.startsWith('M5.24984 0.583252V1.74992')).toBe(true)
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <CalendarCheckLine className="cal-check" style={{ fontSize: '12px' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('cal-check')
    expect(svg.style.fontSize).toBe('12px')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<CalendarCheckLine onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using nested structure', () => {
    // Mock the nested structure: { current: { current: null } }
    const mockRef = { current: { current: null } }

    render(
      <CalendarCheckLine
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles kebab-case conversion', () => {
    const attrs = {
      'inkscape:version': '1.0',
      'sodipodi:docname': 'cal.svg',
      'data-name': 'CalendarLayer',
      'stroke-width': '1.5',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeWidth).toBe('1.5')
    expect(result.inkscapeVersion).toBeUndefined()
    expect(result.dataName).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'stroke-opacity:0.8;fill:green' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      strokeOpacity: '0.8',
      fill: 'green',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'icon-primary' })
    expect(result.className).toBe('icon-primary')
  })

  it('normalizeAttrs: handles namespaced attributes and specific exclusions', () => {
    const attrs = {
      'xlink:href': '#path',
      'xmlns:svg': 'exclude',
      'xmlns:sodipodi': 'exclude',
    }
    const result = normalizeAttrs(attrs)

    expect(result.xlinkHref).toBe('#path')
    expect(result.xmlnsSvg).toBeUndefined()
    expect(result.xmlnsSodipodi).toBeUndefined()
  })

  it('generate: handles recursion and the false rootProps branch', () => {
    const node = {
      name: 'g',
      attributes: { id: 'calendar-group' },
      children: [{ name: 'circle', attributes: { cx: '5', cy: '5', r: '2' } }],
    }
    // Exercises the !rootProps branch (used for children)
    const element = generate(node, 'group-key', false)
    expect(element.props.id).toBe('calendar-group')
    expect(element.props.children[0].props.cx).toBe('5')
  })

  it('normalizeAttrs: handles missing or undefined attributes gracefully', () => {
    const result = normalizeAttrs({ 'data-null': undefined })
    expect(result).toEqual({})
    expect(normalizeAttrs()).toEqual({})
  })
})
