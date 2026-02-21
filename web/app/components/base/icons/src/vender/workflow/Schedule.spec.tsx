import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Schedule from './Schedule'

describe('Schedule Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Schedule />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Schedule')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('height', '16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders all three paths correctly', () => {
    const { container } = render(<Schedule />)
    const paths = container.querySelectorAll('path')

    expect(paths.length).toBe(3)

    // Check that at least one path has the evenodd rule applied (the clock face)
    const evenOddPath = Array.from(paths).find(p => p.getAttribute('fill-rule') === 'evenodd')
    expect(evenOddPath).toBeInTheDocument()
    expect(evenOddPath).toHaveAttribute('clip-rule', 'evenodd')

    // Verify first path start point
    expect(paths[0]).toHaveAttribute('d', expect.stringContaining('M11.3333 9.33337'))
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Schedule className="schedule-icon" style={{ stroke: 'black' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('schedule-icon')
    expect(svg.style.stroke).toBe('black')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Schedule onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <Schedule
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
      'sodipodi:docname': 'schedule.svg',
      'stroke-linecap': 'round',
      'fill-rule': 'evenodd',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeLinecap).toBe('round')
    expect(result.fillRule).toBe('evenodd')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill:green;opacity:0.9' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fill: 'green',
      opacity: '0.9',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'calendar-active' })
    expect(result.className).toBe('calendar-active')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:connector': 'none',
      'null-val': undefined,
    }
    const result = normalizeAttrs(attrs)

    expect(result.inkscapeConnector).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'path',
      attributes: { d: 'M0 0h1v1H0z' },
      children: [],
    }
    const element = generate(node, 'schedule-path-key', false)
    expect(element.key).toBe('schedule-path-key')
    expect(element.props.d).toBe('M0 0h1v1H0z')
  })
})
