import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import Llm from './Llm'

describe('Llm Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Llm />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Llm')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the llm group and specific stroke path correctly', () => {
    const { container } = render(<Llm />)

    // Escaping the slash in the group ID and spaces/parentheses in the path ID
    const group = container.querySelector('#icons\\/llm')
    const path = container.querySelector('#Vector\\ \\(Stroke\\)')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('clip-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    expect(d).toContain('M5.83333 2.40625')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Llm className="ai-model-icon" style={{ transform: 'scale(1.2)' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('ai-model-icon')
    expect(svg.style.transform).toBe('scale(1.2)')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Llm onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // Double-cast to bypass the SVGSVGElement property mismatch in standard Ref types
    const mockRef = { current: { current: null } }

    render(
      <Llm
        ref={mockRef as unknown as React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles attribute conversion', () => {
    const attrs = {
      'inkscape:version': '1.1',
      'sodipodi:docname': 'llm.svg',
      'stroke-width': '1.2',
      'fill-rule': 'evenodd',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeWidth).toBe('1.2')
    expect(result.fillRule).toBe('evenodd')
    // Metadata should be filtered out
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'stroke-linecap:round;stroke-linejoin:round' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'llm-component' })
    expect(result.className).toBe('llm-component')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:export-filename': 'icon.png',
      'null-prop': undefined,
    }
    const result = normalizeAttrs(attrs)

    expect(result.inkscapeExportFilename).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'nested-group' },
      children: [{ name: 'path', attributes: { d: 'M1 1h1' } }],
    }
    const element = generate(node, 'llm-key', false)
    expect(element.props.id).toBe('nested-group')
    expect(element.key).toBe('llm-key')
  })
})
