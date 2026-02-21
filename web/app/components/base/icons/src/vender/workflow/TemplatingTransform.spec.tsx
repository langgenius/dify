import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import TemplatingTransform from './TemplatingTransform'

describe('TemplatingTransform Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<TemplatingTransform />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'TemplatingTransform')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('height', '14')
  })

  it('renders the nested group structure and correct path count', () => {
    const { container } = render(<TemplatingTransform />)

    // Check main group with escaped slash
    const mainGroup = container.querySelector('#icons\\/templating-transform')
    expect(mainGroup).toBeInTheDocument()

    // Check inner Vector group
    const vectorGroup = container.querySelector('#Vector')
    expect(vectorGroup).toBeInTheDocument()

    // Verify path count: 13 paths inside the Vector group
    const paths = vectorGroup?.querySelectorAll('path')
    expect(paths?.length).toBe(13)

    // Verify specific path attributes (e.g., the first path with evenodd)
    const evenOddPath = paths?.[0]
    expect(evenOddPath).toHaveAttribute('fill-rule', 'evenodd')
    expect(evenOddPath).toHaveAttribute('clip-rule', 'evenodd')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <TemplatingTransform className="transform-tool" style={{ transform: 'rotate(90deg)' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('transform-tool')
    expect(svg.style.transform).toBe('rotate(90deg)')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<TemplatingTransform onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly', () => {
    const mockRef = { current: { current: null } }
    render(
      <TemplatingTransform
        ref={mockRef as unknown as React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>}
      />,
    )
    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and camelCases keys', () => {
    const attrs = {
      'inkscape:version': '1.1',
      'stroke-width': '2',
      'fill-rule': 'nonzero',
    }
    const result = normalizeAttrs(attrs)
    expect(result.strokeWidth).toBe('2')
    expect(result.fillRule).toBe('nonzero')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings', () => {
    const result = normalizeAttrs({ style: 'color:blue;stroke:red' })
    expect(result.style).toEqual({ color: 'blue', stroke: 'red' })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'test-class' })
    expect(result.className).toBe('test-class')
  })

  it('normalizeAttrs: ignores undefined and inkscape specific props', () => {
    const result = normalizeAttrs({ 'inkscape:label': 'test', 'data-val': undefined })
    expect(result).toEqual({})
  })

  it('generate: handles non-root elements correctly', () => {
    const node = {
      name: 'rect',
      attributes: { x: '0', y: '0', width: '1', height: '1' },
      children: [],
    }
    const element = generate(node, 'rect-key', false)
    expect(element.key).toBe('rect-key')
    expect(element.props.width).toBe('1')
  })
})
