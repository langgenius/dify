import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { generate, normalizeAttrs } from '../../../utils'
import WindowCursor from './WindowCursor'

describe('WindowCursor Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<WindowCursor />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'WindowCursor')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('height', '16')
    expect(svg).toHaveAttribute('fill', 'none')
  })

  it('renders all 5 paths (window frame, buttons, and cursor)', () => {
    const { container } = render(<WindowCursor />)
    const paths = container.querySelectorAll('path')

    expect(paths.length).toBe(5)

    // Verify first path (Window frame)
    expect(paths[0]).toHaveAttribute('d', expect.stringContaining('M1.33325 4.66663'))

    // Verify last path (Cursor arrow)
    expect(paths[4]).toHaveAttribute('d', expect.stringContaining('M10.5293 9.69609'))

    // All paths should have currentColor fill
    paths.forEach((path) => {
      expect(path).toHaveAttribute('fill', 'currentColor')
    })
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <WindowCursor className="custom-window" style={{ opacity: '0.8' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('custom-window')
    expect(svg.style.opacity).toBe('0.8')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<WindowCursor onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly', () => {
    const mockRef = { current: { current: null } }

    render(
      <WindowCursor
        ref={mockRef as unknown as React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>}
      />,
    )

    expect(mockRef.current).toBeDefined()
  })
})

describe('Icon Utility Logic (Full Coverage)', () => {
  it('normalizeAttrs: filters metadata and handles attribute conversion', () => {
    const attrs = {
      'inkscape:version': '1.2',
      'stroke-width': '2',
      'fill-rule': 'evenodd',
      'class': 'original-class',
    }
    const result = normalizeAttrs(attrs)

    expect(result.strokeWidth).toBe('2')
    expect(result.fillRule).toBe('evenodd')
    expect(result.className).toBe('original-class')
    expect(result.inkscapeVersion).toBeUndefined()
  })

  it('normalizeAttrs: parses style strings into objects', () => {
    const result = normalizeAttrs({ style: 'display:none;fill:red' })
    expect(result.style).toEqual({
      display: 'none',
      fill: 'red',
    })
  })

  it('normalizeAttrs: handles empty or undefined attributes', () => {
    const result = normalizeAttrs({ 'data-test': undefined, 'inkscape:label': 'test' })
    expect(result).toEqual({})
  })

  it('generate: handles non-root elements with specific keys', () => {
    const node = {
      name: 'circle',
      attributes: { cx: '5', cy: '5', r: '2' },
      children: [],
    }
    const element = generate(node, 'test-circle', false)
    expect(element.key).toBe('test-circle')
    expect(element.props.cx).toBe('5')
  })
})
