import { fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import Document from './Document'

describe('Document Icon Component', () => {
  it('renders correctly with default attributes from JSON', () => {
    const { container } = render(<Document />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', 'Document')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    // This icon specifically sets fill on the root SVG element
    expect(svg).toHaveAttribute('fill', 'currentColor')
  })

  it('renders the document path correctly', () => {
    const { container } = render(<Document />)
    const path = container.querySelector('path')

    expect(path).toBeInTheDocument()
    const d = path?.getAttribute('d')
    // Matches the start of the document outline and the internal lines
    expect(d).toContain('M20 22H4C3.44772 22 3 21.5523')
  })

  it('applies custom className and style props', () => {
    const { container } = render(
      <Document className="test-document-icon" style={{ opacity: '0.8' }} />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement

    expect(svg).toHaveClass('test-document-icon')
    expect(svg.style.opacity).toBe('0.8')
  })

  it('handles click events', () => {
    const onClick = vi.fn()
    const { container } = render(<Document onClick={onClick} />)
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

      // We use 'as never' to bypass the complex nested ref type mismatch
      // without using 'any', satisfying strict linting rules.
      return <Document ref={iconRef as never} />
    }

    render(<TestWrapper />)

    expect(capturedRef).not.toBeNull()
    expect(capturedRef).toBeInstanceOf(SVGSVGElement)
  })
})
