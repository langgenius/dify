import { fireEvent, render, screen } from '@testing-library/react'
import Empty from './empty'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'segment.empty')
        return 'No results found'
      if (key === 'segment.clearFilter')
        return 'Clear Filter'
      return key
    },
  }),
}))

describe('Empty Component', () => {
  const defaultProps = {
    onClearFilter: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render empty state message', () => {
      render(<Empty {...defaultProps} />)

      expect(screen.getByText('No results found')).toBeInTheDocument()
    })

    it('should render clear filter button', () => {
      render(<Empty {...defaultProps} />)

      expect(screen.getByText('Clear Filter')).toBeInTheDocument()
    })

    it('should render icon', () => {
      const { container } = render(<Empty {...defaultProps} />)

      // Check for the icon container
      const iconContainer = container.querySelector('.shadow-lg')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render decorative lines', () => {
      const { container } = render(<Empty {...defaultProps} />)

      // Check for SVG lines
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })

    it('should render background cards', () => {
      const { container } = render(<Empty {...defaultProps} />)

      // Check for background empty cards (10 of them)
      const backgroundCards = container.querySelectorAll('.rounded-xl.bg-background-section-burn')
      expect(backgroundCards.length).toBe(10)
    })

    it('should render mask overlay', () => {
      const { container } = render(<Empty {...defaultProps} />)

      const maskOverlay = container.querySelector('.bg-dataset-chunk-list-mask-bg')
      expect(maskOverlay).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call onClearFilter when clear filter button is clicked', () => {
      const onClearFilter = vi.fn()

      render(<Empty onClearFilter={onClearFilter} />)

      const clearButton = screen.getByText('Clear Filter')
      fireEvent.click(clearButton)

      expect(onClearFilter).toHaveBeenCalledTimes(1)
    })
  })

  describe('Memoization', () => {
    it('should be memoized', () => {
      // Empty is wrapped with React.memo
      const { rerender } = render(<Empty {...defaultProps} />)

      // Same props should not cause re-render issues
      rerender(<Empty {...defaultProps} />)

      expect(screen.getByText('No results found')).toBeInTheDocument()
    })
  })
})

describe('EmptyCard Component', () => {
  it('should render within Empty component', () => {
    const { container } = render(<Empty onClearFilter={vi.fn()} />)

    // EmptyCard renders as background cards
    const emptyCards = container.querySelectorAll('.h-32.w-full')
    expect(emptyCards.length).toBe(10)
  })

  it('should have correct opacity', () => {
    const { container } = render(<Empty onClearFilter={vi.fn()} />)

    const emptyCards = container.querySelectorAll('.opacity-30')
    expect(emptyCards.length).toBe(10)
  })
})

describe('Line Component', () => {
  it('should render SVG lines within Empty component', () => {
    const { container } = render(<Empty onClearFilter={vi.fn()} />)

    // Line components render as SVG elements (4 Line components + 1 icon SVG)
    const lines = container.querySelectorAll('svg')
    expect(lines.length).toBeGreaterThanOrEqual(4)
  })

  it('should have gradient definition', () => {
    const { container } = render(<Empty onClearFilter={vi.fn()} />)

    const gradients = container.querySelectorAll('linearGradient')
    expect(gradients.length).toBeGreaterThan(0)
  })
})
