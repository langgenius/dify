import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SVGRenderer from '.'

const mockClick = vi.fn()
const mockSvg = vi.fn().mockReturnValue({
  click: mockClick,
})
const mockViewbox = vi.fn()
const mockAddTo = vi.fn()

vi.mock('@svgdotjs/svg.js', () => ({
  SVG: vi.fn().mockImplementation(() => ({
    addTo: mockAddTo,
  })),
}))

vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn(content => content),
  },
}))

describe('SVGRenderer', () => {
  const validSvg = '<svg width="100" height="100"><circle cx="50" cy="50" r="40" /></svg>'
  let parseFromStringSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.clearAllMocks()
    mockAddTo.mockReturnValue({
      viewbox: mockViewbox,
      svg: mockSvg,
    })
    mockSvg.mockReturnValue({
      click: mockClick,
    })

    const mockSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    mockSvgElement.setAttribute('width', '100')
    mockSvgElement.setAttribute('height', '100')
    parseFromStringSpy = vi.spyOn(DOMParser.prototype, 'parseFromString').mockReturnValue({
      documentElement: mockSvgElement,
    } as unknown as Document)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Rendering', () => {
    it('renders correctly with content', async () => {
      render(<SVGRenderer content={validSvg} />)

      await waitFor(() => {
        expect(mockViewbox).toHaveBeenCalledWith(0, 0, 100, 100)
      })
      expect(mockSvg).toHaveBeenCalledWith(validSvg)
    })

    it('shows error message on invalid SVG content', async () => {
      parseFromStringSpy.mockReturnValue({
        documentElement: document.createElement('div'),
      } as unknown as Document)

      render(<SVGRenderer content="invalid" />)

      await waitFor(() => {
        expect(screen.getByText(/Error rendering SVG/)).toBeInTheDocument()
      })
    })

    it('re-renders on window resize', async () => {
      render(<SVGRenderer content={validSvg} />)
      await waitFor(() => {
        expect(mockAddTo).toHaveBeenCalledTimes(1)
      })

      await act(async () => {
        window.dispatchEvent(new Event('resize'))
      })

      await waitFor(() => {
        expect(mockAddTo).toHaveBeenCalledTimes(2)
      })
    })

    it('uses default values for width/height if not present', async () => {
      const mockSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      parseFromStringSpy.mockReturnValue({
        documentElement: mockSvgElement,
      } as unknown as Document)

      render(<SVGRenderer content="<svg></svg>" />)

      await waitFor(() => {
        expect(mockViewbox).toHaveBeenCalledWith(0, 0, 400, 600)
      })
    })
  })

  describe('Image Preview Interactions', () => {
    it('opens image preview on click', async () => {
      render(<SVGRenderer content={validSvg} />)

      await waitFor(() => {
        expect(mockClick).toHaveBeenCalled()
      })
      const clickHandler = mockClick.mock.calls[0][0]

      await act(async () => {
        clickHandler()
      })
      const img = screen.getByAltText('Preview')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute(
        'src',
        expect.stringContaining('data:image/svg+xml;base64'),
      )
    })

    it('closes image preview on cancel', async () => {
      render(<SVGRenderer content={validSvg} />)

      await waitFor(() => {
        expect(mockClick).toHaveBeenCalled()
      })
      const clickHandler = mockClick.mock.calls[0][0]
      await act(async () => {
        clickHandler()
      })

      expect(screen.getByAltText('Preview')).toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(screen.queryByAltText('Preview')).not.toBeInTheDocument()
    })
  })
})
