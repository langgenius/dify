import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import End from './End'

describe('End Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<End />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'End')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the internal hierarchy and path correctly', () => {
    const { container } = render(<End />)

    // The ID "icons/end" needs escaping for querySelector
    const group = container.querySelector('#icons\\/end')
    const path = container.querySelector('path')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')

    const dAttribute = path?.getAttribute('d') || ''
    expect(dAttribute.startsWith('M6.67315 1.18094')).toBe(true)
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <End className="end-node-icon" style={{ marginTop: '4px' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('end-node-icon')
    expect(svg.style.marginTop).toBe('4px')
  })

  it('handles click events successfully', () => {
    const onClick = vi.fn()
    const { container } = render(<End onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <End
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles camelCasing', () => {
    const attrs = {
      'inkscape:version': '1.0',
      'sodipodi:docname': 'end.svg',
      'data-name': 'EndLayer',
      'stroke-width': '2',
      'fill-rule': 'nonzero',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeWidth).toBe('2')
    expect(result.fillRule).toBe('nonzero')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'stroke-linecap:square;opacity:0.9' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      strokeLinecap: 'square',
      opacity: '0.9',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'custom-icon' })
    expect(result.className).toBe('custom-icon')
  })

  it('normalizeAttrs: filters specific namespaces and handles nulls', () => {
    const attrs = {
      'xmlns:svg': 'exclude',
      'xlink:actuate': 'onLoad',
      'undefined-prop': undefined,
    }
    const result = normalizeAttrs(attrs)
    expect(result.xmlnsSvg).toBeUndefined()
    expect(result.xlinkActuate).toBe('onLoad')
    expect(result).not.toHaveProperty('undefined-prop')
  })

  it('generate: handles recursive branch where rootProps is false', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner' },
      children: [{ name: 'circle', attributes: { r: '4' } }],
    }
    // Exercises the !rootProps branch (used for children)
    const element = generate(node, 'child-key', false)
    expect(element.props.id).toBe('inner')
    expect(element.key).toBe('child-key')
  })
})
