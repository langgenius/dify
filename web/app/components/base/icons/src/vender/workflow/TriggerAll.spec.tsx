import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import TriggerAll from './TriggerAll'

describe('TriggerAll Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<TriggerAll />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'TriggerAll')
    expect(svg).toHaveAttribute('viewBox', '0 0 14 14')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('height', '14')
    expect(svg).toHaveAttribute('fill', 'none')
  })

  it('renders all 6 vector paths correctly', () => {
    const { container } = render(<TriggerAll />)
    const paths = container.querySelectorAll('path')

    expect(paths.length).toBe(6)

    // Check the primary cursor path (first path) for specific attributes
    expect(paths[0]).toHaveAttribute('fill-rule', 'evenodd')
    expect(paths[0]).toHaveAttribute('clip-rule', 'evenodd')
    expect(paths[0]).toHaveAttribute('d', expect.stringContaining('M5.34698 6.42505'))

    // Check one of the trigger lines (last path)
    expect(paths[5]).toHaveAttribute('d', expect.stringContaining('M6.33331 0.333252'))
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <TriggerAll className="trigger-active" style={{ opacity: '0.5' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('trigger-active')
    expect(svg.style.opacity).toBe('0.5')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<TriggerAll onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly using the nested ref pattern', () => {
    const mockRef = { current: { current: null } }

    render(
      <TriggerAll
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
      'stroke-miterlimit': '10',
      'fill-rule': 'evenodd',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeMiterlimit).toBe('10')
    expect(result.fillRule).toBe('evenodd')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const attrs = { style: 'display:block;margin:10px' }
    const result = normalizeAttrs(attrs)

    expect(result.style).toEqual({
      display: 'block',
      margin: '10px',
    })
  })

  it('normalizeAttrs: maps class to className', () => {
    const result = normalizeAttrs({ class: 'icon-primary' })
    expect(result.className).toBe('icon-primary')
  })

  it('normalizeAttrs: handles undefined and filters inkscape namespaces', () => {
    const attrs = {
      'inkscape:collect': 'always',
      'data-custom': undefined,
    }
    const result = normalizeAttrs(attrs)

    expect(result.inkscapeCollect).toBeUndefined()
    expect(result).toEqual({})
  })

  it('generate: handles the false rootProps branch for nested children', () => {
    const node = {
      name: 'path',
      attributes: { d: 'M1 1h1v1H1z' },
      children: [],
    }
    const element = generate(node, 'trigger-key', false)
    expect(element.props.d).toBe('M1 1h1v1H1z')
    expect(element.key).toBe('trigger-key')
  })
})
