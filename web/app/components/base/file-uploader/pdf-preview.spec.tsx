import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import PdfPreview from './pdf-preview'

vi.mock('./pdf-highlighter-adapter', () => ({
  PdfLoader: ({ children, beforeLoad }: { children: (doc: unknown) => ReactNode, beforeLoad: ReactNode }) => (
    <div data-testid="pdf-loader">
      {beforeLoad}
      {children({ numPages: 1 })}
    </div>
  ),
  PdfHighlighter: ({ enableAreaSelection, highlightTransform, scrollRef, onScrollChange, onSelectionFinished }: {
    enableAreaSelection?: (event: MouseEvent) => boolean
    highlightTransform?: () => ReactNode
    scrollRef?: (ref: unknown) => void
    onScrollChange?: () => void
    onSelectionFinished?: () => unknown
  }) => {
    enableAreaSelection?.(new MouseEvent('click'))
    highlightTransform?.()
    scrollRef?.(null)
    onScrollChange?.()
    onSelectionFinished?.()
    return <div data-testid="pdf-highlighter" />
  },
}))

describe('PdfPreview', () => {
  const mockOnCancel = vi.fn()

  const getScaleContainer = () => {
    const container = document.querySelector('div[style*="transform"]') as HTMLDivElement | null
    expect(container).toBeInTheDocument()
    return container!
  }

  const getControl = (rightClass: 'right-24' | 'right-16' | 'right-6') => {
    const control = document.querySelector(`div.absolute.${rightClass}.top-6`) as HTMLDivElement | null
    expect(control).toBeInTheDocument()
    return control!
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.innerWidth = 1024
    fireEvent(window, new Event('resize'))
  })

  it('should render the pdf preview portal with overlay and loading indicator', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    expect(document.querySelector('[tabindex="-1"]')).toBeInTheDocument()
    expect(screen.getByTestId('pdf-loader')).toBeInTheDocument()
    expect(screen.getByTestId('pdf-highlighter')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should render zoom in, zoom out, and close icon SVGs', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    const svgs = document.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(3)
  })

  it('should zoom in when zoom in control is clicked', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    fireEvent.click(getControl('right-16'))

    expect(getScaleContainer().getAttribute('style')).toContain('scale(1.2)')
  })

  it('should zoom out when zoom out control is clicked', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    fireEvent.click(getControl('right-24'))

    expect(getScaleContainer().getAttribute('style')).toMatch(/scale\(0\.8333/)
  })

  it('should keep non-1 scale when zooming out from a larger scale', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    fireEvent.click(getControl('right-16'))
    fireEvent.click(getControl('right-16'))
    fireEvent.click(getControl('right-24'))

    expect(getScaleContainer().getAttribute('style')).toContain('scale(1.2)')
  })

  it('should reset scale back to 1 when zooming in then out', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    fireEvent.click(getControl('right-16'))
    fireEvent.click(getControl('right-24'))

    expect(getScaleContainer().getAttribute('style')).toContain('scale(1)')
  })

  it('should zoom in when ArrowUp key is pressed', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    fireEvent.keyDown(document, { key: 'ArrowUp', code: 'ArrowUp' })

    expect(getScaleContainer().getAttribute('style')).toContain('scale(1.2)')
  })

  it('should zoom out when ArrowDown key is pressed', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    fireEvent.keyDown(document, { key: 'ArrowDown', code: 'ArrowDown' })

    expect(getScaleContainer().getAttribute('style')).toMatch(/scale\(0\.8333/)
  })

  it('should call onCancel when close control is clicked', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    fireEvent.click(getControl('right-6'))

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should call onCancel when Escape key is pressed', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should render the overlay and stop click propagation', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    const overlay = document.querySelector('[tabindex="-1"]')
    expect(overlay).toBeInTheDocument()
    const event = new MouseEvent('click', { bubbles: true })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    overlay!.dispatchEvent(event)
    expect(stopPropagation).toHaveBeenCalled()
  })
})
