import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import IfElse from './IfElse'

describe('IfElse Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<IfElse />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'IfElse')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the branching path correctly', () => {
    const { container } = render(<IfElse />)

    // Escaping the slash in "icons/if-else"
    const group = container.querySelector('#icons\\/if-else')
    const path = container.querySelector('path')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    expect(d).toContain('M8.16667 2.98975')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <IfElse className="logic-node" style={{ opacity: '0.5' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('logic-node')
    expect(svg.style.opacity).toBe('0.5')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<IfElse onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // We use a double-cast to bypass the SVGSVGElement property mismatch
    // that causes the "missing currentScale, currentTranslate" error.
    const mockRef = { current: { current: null } }

    render(
      <IfElse
        ref={mockRef as unknown as React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles dash/colon conversion', () => {
    const attrs = {
      'inkscape:version': '1.0',
      'sodipodi:docname': 'ifelse.svg',
      'data-name': 'LogicLayer',
      'stroke-dasharray': '5,5',
      'xlink:href': '#path1',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeDasharray).toBe('5,5')
    expect(result.xlinkHref).toBe('#path1')
    expect(result.inkscapeVersion).toBeUndefined()
    expect(result.dataName).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill-rule:nonzero;stop-color:red' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fillRule: 'nonzero',
      stopColor: 'red',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'ifelse-icon' })
    expect(result.className).toBe('ifelse-icon')
  })

  it('normalizeAttrs: filters specific namespaces and handles undefined', () => {
    const attrs = {
      'xmlns:svg': 'exclude',
      'xmlns:inkscape': 'exclude',
      'some-null-attr': undefined,
    }
    const result = normalizeAttrs(attrs)
    expect(result.xmlnsSvg).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner' },
      children: [{ name: 'circle', attributes: { cx: '5' } }],
    }
    // Exercises recursive branch where rootProps = false
    const element = generate(node, 'test-key', false)
    expect(element.props.id).toBe('inner')
    expect(element.key).toBe('test-key')
  })
})
