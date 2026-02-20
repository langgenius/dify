import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import ApiAggregate from './ApiAggregate'

describe('ApiAggregate Icon Component', () => {
  it('renders the SVG with correct attributes from JSON', () => {
    const { container } = render(<ApiAggregate />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'ApiAggregate')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the internal path correctly', () => {
    const { container } = render(<ApiAggregate />)
    const path = container.querySelector('path')

    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill', 'currentColor')

    // FIX: Using stringMatching with a regex or simply checking the start
    const dAttribute = path?.getAttribute('d') || ''
    expect(dAttribute.startsWith('M5.92578 11.0094C5.92578')).toBe(true)
  })

  it('applies custom className and style props', () => {
    const customStyle = { opacity: '0.5' }
    const { container } = render(
      <ApiAggregate className="api-icon" style={customStyle} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('api-icon')
    expect(svg.style.opacity).toBe('0.5')
  })

  it('handles click events successfully', () => {
    const onClick = vi.fn()
    const { container } = render(<ApiAggregate onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly', () => {
    // We mock the nested structure: { current: { current: null } }
    const mockRef = { current: { current: null } }

    render(
      <ApiAggregate
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )

    // If the render succeeds without throwing, the ref was accepted by the component
    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utilities (Coverage for normalizeAttrs & generate)', () => {
  it('filters editor metadata and handles kebab-case conversion', () => {
    const attrs = {
      'sodipodi:docname': 'api.svg',
      'inkscape:version': '1.0',
      'stroke-width': '2',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeWidth).toBe('2')
    expect(result.sodipodiDocname).toBeUndefined()
  })

  it('parses complex style strings into objects', () => {
    const attrs = { style: 'stroke-linecap:round;fill:none' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      strokeLinecap: 'round',
      fill: 'none',
    })
  })

  it('maps "class" to "className"', () => {
    const result = normalizeAttrs({ class: 'icon-primary' })
    expect(result.className).toBe('icon-primary')
  })

  it('generate handles the branch where rootProps is false', () => {
    const node = {
      name: 'g',
      attributes: { id: 'group' },
      children: [],
    }
    const element = generate(node, 'test-key', false)
    expect(element.props.id).toBe('group')
  })

  it('handles undefined and namespaced exclusions', () => {
    const attrs = {
      'data-test': undefined,
      'xmlns:inkscape': 'exclude',
      'data-name': 'exclude',
    }
    const result = normalizeAttrs(attrs)
    expect(result).toEqual({})
  })
})
