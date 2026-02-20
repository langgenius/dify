import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import ContentModeration from './ContentModeration'

describe('ContentModeration Icon Component', () => {
  it('renders correctly with default attributes', () => {
    const { container } = render(<ContentModeration />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'ContentModeration')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '24')
  })

  it('renders the specific moderation path geometry', () => {
    const { container } = render(<ContentModeration />)
    const path = container.querySelector('path')

    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill-rule', 'evenodd')
    expect(path).toHaveAttribute('clip-rule', 'evenodd')

    const d = path?.getAttribute('d')
    expect(d).toContain('M7.16146 3H16.8385')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <ContentModeration className="custom-class" style={{ opacity: '0.5' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('custom-class')
    expect(svg.style.opacity).toBe('0.5')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<ContentModeration onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs correctly to the SVG element', () => {
    let capturedRef: SVGSVGElement | null = null

    const TestWrapper = () => {
      const iconRef = React.useRef<SVGSVGElement>(null)
      React.useEffect(() => {
        capturedRef = iconRef.current
      }, [])
      // We cast to any here only if the component's internal ref type is
      // the "nested ref" mentioned by the reviewer, otherwise standard ref works.
      return <ContentModeration ref={iconRef as never} />
    }

    render(<TestWrapper />)
    expect(capturedRef).toBeInstanceOf(SVGSVGElement)
  })
})
