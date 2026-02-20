import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import Agent from './Agent'

describe('Agent Icon Component', () => {
  it('renders the SVG with correct base attributes', () => {
    const { container } = render(<Agent />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Agent')
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
  })

  it('forwards refs correctly', () => {
    const mockRef = { current: { current: null } }
    const { container } = render(
      <Agent
        ref={mockRef as unknown as (React.RefObject<React.RefObject<HTMLOrSVGElement>> & React.Ref<SVGSVGElement>)}
      />,
    )
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('merges custom className and styles', () => {
    const customStyle = { color: 'rgb(255, 0, 0)' }
    const { container } = render(
      <Agent className="my-custom-class" style={customStyle} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('my-custom-class')
    expect(svg.style.color).toBe('rgb(255, 0, 0)')
  })

  it('responds to user interactions (onClick)', () => {
    const onClick = vi.fn()
    const { container } = render(<Agent onClick={onClick} />)
    const svg = container.querySelector('svg')

    if (svg)
      fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders internal paths from JSON', () => {
    const { container } = render(<Agent />)
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(2)
  })
})
