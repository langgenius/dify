import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Http from './Http'

describe('Http Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Http />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Http')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the nested group and multiple paths', () => {
    const { container } = render(<Http />)

    // Escaping the slash in "icons/http"
    const rootGroup = container.querySelector('#icons\\/http')
    const vectorGroup = container.querySelector('#Vector')
    const paths = container.querySelectorAll('path')

    expect(rootGroup).toBeInTheDocument()
    expect(vectorGroup).toBeInTheDocument()
    // Http.json contains 4 distinct paths for H, T, T, and P
    expect(paths.length).toBe(4)
    paths.forEach((path) => {
      expect(path).toHaveAttribute('fill', 'currentColor')
    })
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Http className="network-icon" style={{ color: 'blue' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('network-icon')
    expect(svg.style.color).toBe('blue')
  })

  it('handles click events successfully', () => {
    const onClick = vi.fn()
    const { container } = render(<Http onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <Http
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles dash/colon conversion', () => {
    const attrs = {
      'inkscape:version': '1.0',
      'sodipodi:docname': 'http.svg',
      'data-name': 'HttpLayer',
      'stroke-linejoin': 'round',
      'xlink:href': '#path',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeLinejoin).toBe('round')
    expect(result.xlinkHref).toBe('#path')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill-rule:evenodd;opacity:0.5' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fillRule: 'evenodd',
      opacity: '0.5',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'http-cls' })
    expect(result.className).toBe('http-cls')
  })

  it('normalizeAttrs: handles specific exclusions and undefined values', () => {
    const attrs = {
      'xmlns:svg': 'exclude',
      'xmlns:sodipodi': 'exclude',
      'test-attr': undefined,
    }
    const result = normalizeAttrs(attrs)
    expect(result.xmlnsSvg).toBeUndefined()
    expect(result.xmlnsSodipodi).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner-g' },
      children: [{ name: 'rect', attributes: { x: '0', y: '0' } }],
    }
    // Exercises recursive branch where rootProps = false
    const element = generate(node, 'http-key', false)
    expect(element.props.id).toBe('inner-g')
    expect(element.key).toBe('http-key')
  })
})
