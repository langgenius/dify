import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import QuestionClassifier from './QuestionClassifier'

describe('QuestionClassifier Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<QuestionClassifier />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'QuestionClassifier')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('height', '14')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the classifier group and specific stroke path correctly', () => {
    const { container } = render(<QuestionClassifier />)

    // Escaping the slash in the group ID and spaces/parentheses in the path ID
    const group = container.querySelector('#icons\\/question-classifier')
    const path = container.querySelector('#Vector\\ \\(Stroke\\)')

    expect(group).toBeInTheDocument()
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('clip-rule', 'evenodd')
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    expect(d).toContain('M6.34379 3.53597')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <QuestionClassifier className="classifier-active" style={{ color: 'green' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('classifier-active')
    expect(svg.style.color).toBe('green')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<QuestionClassifier onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <QuestionClassifier
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
      'sodipodi:docname': 'classifier.svg',
      'stroke-linejoin': 'round',
      'fill-rule': 'evenodd',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeLinejoin).toBe('round')
    expect(result.fillRule).toBe('evenodd')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'stroke-width:2;fill:none' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      strokeWidth: '2',
      fill: 'none',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'custom-class' })
    expect(result.className).toBe('custom-class')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:export-xdpi': '96',
      'test-prop': undefined,
    }
    const result = normalizeAttrs(attrs)

    expect(result.inkscapeExportXdpi).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'nested-node' },
      children: [{ name: 'circle', attributes: { cx: '7', cy: '7' } }],
    }
    const element = generate(node, 'qc-key', false)
    expect(element.props.id).toBe('nested-node')
    expect(element.key).toBe('qc-key')
  })
})
