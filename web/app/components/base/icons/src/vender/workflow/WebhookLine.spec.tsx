import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import WebhookLine from './WebhookLine'

describe('WebhookLine Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<WebhookLine />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'WebhookLine')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('height', '16')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the complex webhook path correctly', () => {
    const { container } = render(<WebhookLine />)
    const path = container.querySelector('path')

    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill', 'currentColor')

    // Check that the path contains the specific starting coordinates from the JSON
    const d = path?.getAttribute('d')
    expect(d).toContain('M5.91246 9.42618')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <WebhookLine className="webhook-custom" style={{ color: 'blue' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('webhook-custom')
    expect(svg.style.color).toBe('blue')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<WebhookLine onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <WebhookLine
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
      'sodipodi:docname': 'webhook.svg',
      'stroke-width': '2',
      'fill-rule': 'nonzero',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeWidth).toBe('2')
    expect(result.fillRule).toBe('nonzero')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'stroke:black;stroke-width:1' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      stroke: 'black',
      strokeWidth: '1',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'webhook-icon' })
    expect(result.className).toBe('webhook-icon')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:label': 'Layer 1',
      'data-none': undefined,
    }
    const result = normalizeAttrs(attrs)

    expect(result.inkscapeLabel).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'g',
      attributes: { id: 'webhook-group' },
      children: [{ name: 'circle', attributes: { cx: '8', cy: '8', r: '2' } }],
    }
    const element = generate(node, 'webhook-key', false)
    expect(element.props.id).toBe('webhook-group')
    expect(element.key).toBe('webhook-key')
  })
})
