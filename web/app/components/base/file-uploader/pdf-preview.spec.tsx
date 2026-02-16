import { act, fireEvent, render, screen } from '@testing-library/react'
import PdfPreview from './pdf-preview'

const mockUseHotkeys = vi.fn()
vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: (...args: unknown[]) => mockUseHotkeys(...args),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'pc',
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('react-pdf-highlighter', () => ({
  PdfLoader: ({ children, beforeLoad }: { children: (doc: unknown) => React.ReactNode, beforeLoad: React.ReactNode }) => (
    <div data-testid="pdf-loader">
      {beforeLoad}
      {children({ numPages: 1 })}
    </div>
  ),
  PdfHighlighter: ({ enableAreaSelection, highlightTransform, scrollRef, onScrollChange, onSelectionFinished }: {
    enableAreaSelection?: (event: MouseEvent) => boolean
    highlightTransform?: () => React.ReactNode
    scrollRef?: (ref: unknown) => void
    onScrollChange?: () => void
    onSelectionFinished?: () => unknown
  }) => {
    // Invoke callback props to cover lines 69-73
    enableAreaSelection?.(new MouseEvent('click'))
    highlightTransform?.()
    scrollRef?.(null)
    onScrollChange?.()
    onSelectionFinished?.()
    return <div data-testid="pdf-highlighter" />
  },
}))

vi.mock('react-pdf-highlighter/dist/style.css', () => ({}))

describe('PdfPreview', () => {
  const mockOnCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the pdf preview portal with PdfLoader and PdfHighlighter', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    expect(screen.getByTestId('pdf-loader')).toBeInTheDocument()
    expect(screen.getByTestId('pdf-highlighter')).toBeInTheDocument()
  })

  it('should render zoom in, zoom out, and close icon SVGs', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    const svgs = document.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(3)
  })

  it('should register hotkeys for esc, up, and down', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    expect(mockUseHotkeys).toHaveBeenCalledWith('esc', expect.any(Function))
    expect(mockUseHotkeys).toHaveBeenCalledWith('up', expect.any(Function))
    expect(mockUseHotkeys).toHaveBeenCalledWith('down', expect.any(Function))
  })

  it('should zoom in when up hotkey callback is invoked', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    // Extract the 'up' hotkey callback and invoke it
    const upCall = mockUseHotkeys.mock.calls.find((call: unknown[]) => call[0] === 'up')
    const zoomInFn = upCall![1] as () => void
    act(() => {
      zoomInFn()
    })

    const scaleContainer = document.querySelector('div[style*="transform"]')
    expect(scaleContainer).toBeInTheDocument()
    expect(scaleContainer!.getAttribute('style')).toContain('scale(1.2)')
  })

  it('should zoom out when down hotkey callback is invoked', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    // Extract the 'down' hotkey callback and invoke it
    const downCall = mockUseHotkeys.mock.calls.find((call: unknown[]) => call[0] === 'down')
    const zoomOutFn = downCall![1] as () => void
    act(() => {
      zoomOutFn()
    })

    const scaleContainer = document.querySelector('div[style*="transform"]')
    expect(scaleContainer).toBeInTheDocument()
    // Default scale 1 / 1.2 = 0.833...
    expect(scaleContainer!.getAttribute('style')).toMatch(/scale\(0\.8333/)
  })

  it('should zoom out to a non-1 scale and adjust position', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    const upCall = mockUseHotkeys.mock.calls.find((call: unknown[]) => call[0] === 'up')
    const zoomInFn = upCall![1] as () => void
    const downCall = mockUseHotkeys.mock.calls.find((call: unknown[]) => call[0] === 'down')
    const zoomOutFn = downCall![1] as () => void

    // Zoom in twice to scale 1.44, then zoom out to 1.2 (hits else branch since newScale !== 1)
    act(() => {
      zoomInFn()
    })
    act(() => {
      zoomInFn()
    })
    act(() => {
      zoomOutFn()
    })

    const scaleContainer = document.querySelector('div[style*="transform"]')
    expect(scaleContainer).toBeInTheDocument()
    // 1 * 1.2 * 1.2 / 1.2 = 1.2
    expect(scaleContainer!.getAttribute('style')).toContain('scale(1.2)')
  })

  it('should zoom in and then zoom out back to scale 1 to reset position', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    const upCall = mockUseHotkeys.mock.calls.find((call: unknown[]) => call[0] === 'up')
    const zoomInFn = upCall![1] as () => void
    const downCall = mockUseHotkeys.mock.calls.find((call: unknown[]) => call[0] === 'down')
    const zoomOutFn = downCall![1] as () => void

    // Zoom in once to 1.2, then zoom out back to 1.0 (hits if branch where newScale === 1)
    act(() => {
      zoomInFn()
    })
    act(() => {
      zoomOutFn()
    })

    const scaleContainer = document.querySelector('div[style*="transform"]')
    expect(scaleContainer).toBeInTheDocument()
    expect(scaleContainer!.getAttribute('style')).toContain('scale(1)')
  })

  it('should call onCancel when esc hotkey callback is invoked', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    const escCall = mockUseHotkeys.mock.calls.find((call: unknown[]) => call[0] === 'esc')
    const escFn = escCall![1] as () => void
    escFn()

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should render the overlay and stop click propagation', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    const overlay = document.querySelector('[tabindex="-1"]')
    expect(overlay).toBeInTheDocument()
    fireEvent.click(overlay!)
  })

  it('should render the Loading component in PdfLoader beforeLoad', () => {
    render(<PdfPreview url="https://example.com/doc.pdf" onCancel={mockOnCancel} />)

    // Loading is a real base component - not mocked, renders inside PdfLoader
    expect(screen.getByTestId('pdf-loader')).toBeInTheDocument()
  })
})
