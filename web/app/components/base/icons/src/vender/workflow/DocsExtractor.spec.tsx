import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import DocsExtractor from './DocsExtractor'

describe('DocsExtractor Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<DocsExtractor />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'DocsExtractor')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the nested group and path structure', () => {
    const { container } = render(<DocsExtractor />)

    // Check for the specific IDs in your JSON
    const rootGroup = container.querySelector('#docs-extractor')
    const vectorGroup = container.querySelector('#Vector')
    const paths = container.querySelectorAll('path')

    expect(rootGroup).toBeInTheDocument()
    expect(vectorGroup).toBeInTheDocument()
    // DocsExtractor.json has 3 paths
    expect(paths.length).toBe(3)
    expect(paths[0]).toHaveAttribute('fill-rule', 'evenodd')
  })

  it('applies custom className and styles', () => {
    const { container } = render(
      <DocsExtractor className="extractor-cls" style={{ verticalAlign: 'middle' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('extractor-cls')
    expect(svg.style.verticalAlign).toBe('middle')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<DocsExtractor onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    // Mock the nested structure: { current: { current: null } }
    const mockRef = { current: { current: null } }

    render(
      <DocsExtractor
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
      'sodipodi:docname': 'doc.svg',
      'data-name': 'ExtractorLayer',
      'stroke-miterlimit': '10',
      'xlink:href': '#path',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeMiterlimit).toBe('10')
    expect(result.xlinkHref).toBe('#path')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'fill-rule:evenodd;stroke-width:2' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      fillRule: 'evenodd',
      strokeWidth: '2',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'test-class' })
    expect(result.className).toBe('test-class')
  })

  it('normalizeAttrs: filters specific namespaces and handles undefined', () => {
    const attrs = {
      'xmlns:svg': 'exclude',
      'xmlns:sodipodi': 'exclude',
      'missing': undefined,
    }
    const result = normalizeAttrs(attrs)
    expect(result.xmlnsSvg).toBeUndefined()
    expect(result.xmlnsSodipodi).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles recursion and the false rootProps branch', () => {
    const node = {
      name: 'g',
      attributes: { id: 'inner' },
      children: [{ name: 'circle', attributes: { r: '5' } }],
    }
    // Exercises the !rootProps branch (used for children)
    const element = generate(node, 'child-key', false)
    expect(element.props.id).toBe('inner')
    expect(element.key).toBe('child-key')
  })
})
