import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InfographicViewer from '../index'

// Mock the @antv/infographic library - must be before imports
const mockRender = vi.fn()
const mockDestroy = vi.fn()
const mockToSVG = vi.fn().mockResolvedValue('<svg>test</svg>')

vi.mock('@antv/infographic', () => ({
  Infographic: vi.fn().mockImplementation(function (this: { options: unknown, render: typeof mockRender, destroy: typeof mockDestroy, toSVG: typeof mockToSVG }, options: unknown) {
    this.options = options
    this.render = mockRender
    this.destroy = mockDestroy
    this.toSVG = mockToSVG
  }),
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

describe('InfographicViewer', () => {
  const validSyntax = `infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1
      desc First step
    - label Step 2
      desc Second step`

  beforeEach(() => {
    vi.clearAllMocks()
    mockRender.mockImplementation(() => {}) // Reset to successful implementation
  })

  it('renders without crashing', () => {
    render(<InfographicViewer syntax={validSyntax} />)
    expect(screen.getByTitle('common.operation.download')).toBeInTheDocument()
  })

  it('calls render with the syntax string', async () => {
    render(<InfographicViewer syntax={validSyntax} />)
    await waitFor(() => {
      expect(mockRender).toHaveBeenCalledWith(validSyntax)
    })
  })

  it('applies custom className', () => {
    const { container } = render(
      <InfographicViewer syntax={validSyntax} className="custom-class" />,
    )
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('uses custom height', () => {
    render(<InfographicViewer syntax={validSyntax} height={800} />)
    const container = document.querySelector('[style*="height"]')
    expect(container).toHaveStyle({ height: '800px' })
  })

  it('calls destroy on unmount', async () => {
    const { unmount } = render(<InfographicViewer syntax={validSyntax} />)
    // Wait for initial render to complete
    await waitFor(() => {
      expect(mockRender).toHaveBeenCalled()
    })
    unmount()
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('re-renders when syntax changes', async () => {
    const { rerender } = render(<InfographicViewer syntax={validSyntax} />)
    await waitFor(() => {
      expect(mockRender).toHaveBeenCalledTimes(1)
    })

    const newSyntax = `infographic list-column-simple-vertical
data
  lists
    - label Item 1
      desc Description`

    rerender(<InfographicViewer syntax={newSyntax} />)
    await waitFor(() => {
      expect(mockDestroy).toHaveBeenCalled()
      expect(mockRender).toHaveBeenCalledTimes(2)
      expect(mockRender).toHaveBeenLastCalledWith(newSyntax)
    })
  })

  it('calls onError when render fails', async () => {
    const onError = vi.fn()
    const errorMessage = 'Render failed'

    mockRender.mockImplementationOnce(() => {
      throw new Error(errorMessage)
    })

    render(<InfographicViewer syntax={validSyntax} onError={onError} />)
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  it('shows error message when render fails', async () => {
    mockRender.mockImplementationOnce(() => {
      throw new Error('Test error')
    })

    render(<InfographicViewer syntax={validSyntax} />)
    await waitFor(() => {
      expect(screen.getByText('Test error')).toBeInTheDocument()
    })
  })
})
