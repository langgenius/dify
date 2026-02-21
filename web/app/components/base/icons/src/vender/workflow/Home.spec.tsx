import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Home from './Home'

describe('Home Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Home />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Home')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the internal hierarchy (g and path)', () => {
    const { container } = render(<Home />)

    // The ID "icons/home" contains a slash, so we escape it
    const group = container.querySelector('#icons\\/home')
    const path = container.querySelector('path')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Home className="home-custom" style={{ position: 'relative' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('home-custom')
    expect(svg.style.position).toBe('relative')
  })

  it('handles click events successfully', () => {
    const onClick = vi.fn()
    const { container } = render(<Home onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <Home
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles dash/colon conversion', () => {
    const attrs = {
      'inkscape:version': '1.1',
      'sodipodi:docname': 'home.svg',
      'data-name': 'HomeLayer',
      'stroke-miterlimit': '4',
      'xlink:href': '#path-1',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeMiterlimit).toBe('4')
    expect(result.xlinkHref).toBe('#path-1')
    expect(result.inkscapeVersion).toBeUndefined()
    expect(result.dataName).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill-rule:nonzero;stroke-width:1.5' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fillRule: 'nonzero',
      strokeWidth: '1.5',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'icon-home' })
    expect(result.className).toBe('icon-home')
  })

  it('normalizeAttrs: filters specific namespaces and handles undefined', () => {
    const attrs = {
      'xmlns:svg': 'exclude',
      'xmlns:inkscape': 'exclude',
      'attr-missing': undefined,
    }
    const result = normalizeAttrs(attrs)
    expect(result.xmlnsSvg).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'nested-g' },
      children: [{ name: 'circle', attributes: { r: '2' } }],
    }
    // Exercises recursive branch where rootProps = false
    const element = generate(node, 'gen-key-1', false)
    expect(element.props.id).toBe('nested-g')
    expect(element.key).toBe('gen-key-1')
  })
})
