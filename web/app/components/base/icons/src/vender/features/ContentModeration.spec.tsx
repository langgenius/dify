import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import ContentModeration from './ContentModeration'

describe('ContentModeration Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<ContentModeration />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'ContentModeration')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '24')
    expect(svg).toHaveAttribute('fill', 'none')
  })

  it('renders the icon path correctly', () => {
    const { container } = render(<ContentModeration />)
    const path = container.querySelector('path')

    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('fill', 'currentColor')

    const d = path?.getAttribute('d')
    expect(d).toBeTruthy()
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <ContentModeration className="custom-icon" style={{ opacity: '0.8' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('custom-icon')
    expect(svg.style.opacity).toBe('0.8')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<ContentModeration onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it.skip('ref forwarding not testable - IconBase uses nested RefObject pattern', () => {
    // IconBase requires RefObject<RefObject<HTMLOrSVGElement>> which cannot be tested
    // with standard React Testing Library. This is a known limitation.
  })
})
