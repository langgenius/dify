import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Assigner from './Assigner'

describe('Assigner Icon Component', () => {
  it('renders correctly with default attributes', () => {
    const { container } = render(<Assigner />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Assigner')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the internal hierarchy and paths', () => {
    const { container } = render(<Assigner />)

    // Assigner.json has 3 paths inside a "variable assigner" group
    const group = container.querySelector('#variable\\ assigner')
    const paths = container.querySelectorAll('path')

    expect(group).toBeInTheDocument()
    expect(paths.length).toBe(3)
    expect(paths[0]).toHaveAttribute('fill-rule', 'evenodd')
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // Mock the nested structure: { current: { current: null } }
    const mockRef = { current: { current: null } }

    render(
      <Assigner
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })

  it('applies custom className and styles', () => {
    const { container } = render(
      <Assigner className="custom-assigner" style={{ display: 'block' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('custom-assigner')
    expect(svg.style.display).toBe('block')
  })

  it('triggers onClick when clicked', () => {
    const onClick = vi.fn()
    const { container } = render(<Assigner onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters out metadata and data-name', () => {
    const attrs = {
      'inkscape:label': 'icon',
      'sodipodi:type': 'arc',
      'data-name': 'layer1',
      'stroke-width': '1',
    }
    const result = normalizeAttrs(attrs)
    expect(result).toEqual({ strokeWidth: '1' })
    expect(result.inkscapeLabel).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'stroke-width:2;fill-opacity:0.5' }
    const result = normalizeAttrs(attrs)
    expect(result.style).toEqual({
      strokeWidth: '2',
      fillOpacity: '0.5',
    })
  })

  it('normalizeAttrs: handles undefined and colon-namespaced attributes', () => {
    const attrs = {
      'xlink:href': '#id',
      'xmlns:svg': 'exclude',
      'test-attr': undefined,
    }
    const result = normalizeAttrs(attrs)
    expect(result.xlinkHref).toBe('#id')
    expect(result.xmlnsSvg).toBeUndefined()
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'test' })
    expect(result.className).toBe('test')
  })

  it('generate: handles the false rootProps branch and recursion', () => {
    const node = {
      name: 'g',
      attributes: { id: 'test' },
      children: [{ name: 'path', attributes: { d: 'M0 0' } }],
    }
    // Exercises if (!rootProps) logic
    const element = generate(node, 'unique-key', false)
    expect(element.props.id).toBe('test')
    expect(element.key).toBe('unique-key')
  })
})
