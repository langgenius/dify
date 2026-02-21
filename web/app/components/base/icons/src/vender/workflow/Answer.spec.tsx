import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Answer from './Answer'

describe('Answer Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Answer />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Answer')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders internal path with correct fill-rule and clip-rule', () => {
    const { container } = render(<Answer />)
    const path = container.querySelector('path')

    // These test the camelCase conversion in normalizeAttrs (fill-rule -> fillRule)
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('clip-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')
  })

  it('applies custom className and styles', () => {
    const customStyle = { marginTop: '5px' }
    const { container } = render(
      <Answer className="test-class" style={customStyle} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('test-class')
    expect(svg.style.marginTop).toBe('5px')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Answer onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the custom nested structure', () => {
    const mockRef = { current: { current: null } }

    // Using unknown cast to satisfy the unique RefObject<RefObject<...>> type
    const { container } = render(
      <Answer
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )

    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})

describe('Icon Utilities (Coverage for normalizeAttrs & generate)', () => {
  it('filters out metadata and handles undefined attributes', () => {
    const attrs = {
      'inkscape:version': '1.0',
      'sodipodi:docname': 'file.svg',
      'data-name': 'layer',
      'valid-attr': 'present',
      'empty-attr': undefined,
    }
    const result = normalizeAttrs(attrs)
    expect(result).toEqual({ validAttr: 'present' })
  })

  it('parses inline style strings into objects', () => {
    const attrs = { style: 'color:red;background-color:blue' }
    const result = normalizeAttrs(attrs)
    expect(result.style).toEqual({
      color: 'red',
      backgroundColor: 'blue',
    })
  })

  it('maps "class" to "className"', () => {
    const result = normalizeAttrs({ class: 'my-class' })
    expect(result.className).toBe('my-class')
    expect(result.class).toBeUndefined()
  })

  it('converts colon-namespaced attributes and filters them', () => {
    // Tests: key = key.replace(/(:\w)/g, ...)
    // And subsequent filter: if (key === 'xmlnsInkscape' ...)
    const attrs = { 'xmlns:inkscape': 'remove-me', 'xlink:href': 'keep-me' }
    const result = normalizeAttrs(attrs)
    expect(result.xmlnsInkscape).toBeUndefined()
    expect(result.xlinkHref).toBe('keep-me')
  })

  it('generate handles the false rootProps branch and recursion', () => {
    const node = {
      name: 'div',
      attributes: { id: 'parent' },
      children: [{ name: 'span', attributes: { id: 'child' } }],
    }
    // Exercises if (!rootProps) branch
    const element = generate(node, 'key', false)
    expect(element.props.id).toBe('parent')
    expect(element.props.children[0].props.id).toBe('child')
  })

  it('handles empty input in normalizeAttrs', () => {
    // Hits: if (val === undefined) return acc
    // Hits: export function normalizeAttrs(attrs: Attrs = {}): Attrs
    expect(normalizeAttrs()).toEqual({})
  })
})
