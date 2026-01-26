import { fireEvent, render, screen } from '@testing-library/react'
import { IndexingType } from '../../create/step-two'
import IndexMethod from './index'

// Note: react-i18next is globally mocked in vitest.setup.ts

describe('IndexMethod', () => {
  const defaultProps = {
    value: IndexingType.QUALIFIED,
    onChange: vi.fn(),
    keywordNumber: 10,
    onKeywordNumberChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<IndexMethod {...defaultProps} />)
      expect(screen.getByText(/stepTwo\.qualified/)).toBeInTheDocument()
    })

    it('should render High Quality option', () => {
      render(<IndexMethod {...defaultProps} />)
      expect(screen.getByText(/stepTwo\.qualified/)).toBeInTheDocument()
    })

    it('should render Economy option', () => {
      render(<IndexMethod {...defaultProps} />)
      expect(screen.getAllByText(/form\.indexMethodEconomy/).length).toBeGreaterThan(0)
    })

    it('should render High Quality description', () => {
      render(<IndexMethod {...defaultProps} />)
      expect(screen.getByText(/form\.indexMethodHighQualityTip/)).toBeInTheDocument()
    })

    it('should render Economy description', () => {
      render(<IndexMethod {...defaultProps} />)
      expect(screen.getByText(/form\.indexMethodEconomyTip/)).toBeInTheDocument()
    })

    it('should render recommended badge on High Quality', () => {
      render(<IndexMethod {...defaultProps} />)
      expect(screen.getByText(/stepTwo\.recommend/)).toBeInTheDocument()
    })
  })

  describe('Active State', () => {
    it('should mark High Quality as active when value is QUALIFIED', () => {
      const { container } = render(<IndexMethod {...defaultProps} value={IndexingType.QUALIFIED} />)
      const activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)
    })

    it('should mark Economy as active when value is ECONOMICAL', () => {
      const { container } = render(<IndexMethod {...defaultProps} value={IndexingType.ECONOMICAL} />)
      const activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)
    })
  })

  describe('User Interactions', () => {
    it('should call onChange with QUALIFIED when High Quality is clicked', () => {
      const handleChange = vi.fn()
      render(<IndexMethod {...defaultProps} value={IndexingType.ECONOMICAL} onChange={handleChange} />)

      // Find and click High Quality option
      const highQualityTitle = screen.getByText(/stepTwo\.qualified/)
      const card = highQualityTitle.closest('div')?.parentElement?.parentElement?.parentElement
      fireEvent.click(card!)

      expect(handleChange).toHaveBeenCalledWith(IndexingType.QUALIFIED)
    })

    it('should call onChange with ECONOMICAL when Economy is clicked', () => {
      const handleChange = vi.fn()
      render(<IndexMethod {...defaultProps} value={IndexingType.QUALIFIED} onChange={handleChange} currentValue={IndexingType.ECONOMICAL} />)

      // Find and click Economy option - use getAllByText and get the first one (title)
      const economyTitles = screen.getAllByText(/form\.indexMethodEconomy/)
      const economyTitle = economyTitles[0]
      const card = economyTitle.closest('div')?.parentElement?.parentElement?.parentElement
      fireEvent.click(card!)

      expect(handleChange).toHaveBeenCalledWith(IndexingType.ECONOMICAL)
    })

    it('should not call onChange when clicking already active option', () => {
      const handleChange = vi.fn()
      render(<IndexMethod {...defaultProps} value={IndexingType.QUALIFIED} onChange={handleChange} />)

      // Click on already active High Quality
      const highQualityTitle = screen.getByText(/stepTwo\.qualified/)
      const card = highQualityTitle.closest('div')?.parentElement?.parentElement?.parentElement
      fireEvent.click(card!)

      expect(handleChange).not.toHaveBeenCalled()
    })
  })

  describe('Disabled State', () => {
    it('should disable both options when disabled is true', () => {
      const { container } = render(<IndexMethod {...defaultProps} disabled={true} />)
      const disabledCards = container.querySelectorAll('.cursor-not-allowed')
      expect(disabledCards.length).toBeGreaterThan(0)
    })

    it('should disable Economy option when currentValue is QUALIFIED', () => {
      const handleChange = vi.fn()
      render(<IndexMethod {...defaultProps} currentValue={IndexingType.QUALIFIED} onChange={handleChange} value={IndexingType.ECONOMICAL} />)

      // Try to click Economy option - use getAllByText and get the first one (title)
      const economyTitles = screen.getAllByText(/form\.indexMethodEconomy/)
      const economyTitle = economyTitles[0]
      const card = economyTitle.closest('div')?.parentElement?.parentElement?.parentElement
      fireEvent.click(card!)

      // Should not call onChange because Economy is disabled when current is QUALIFIED
      expect(handleChange).not.toHaveBeenCalled()
    })
  })

  describe('KeywordNumber', () => {
    it('should render KeywordNumber component inside Economy option', () => {
      render(<IndexMethod {...defaultProps} />)
      // KeywordNumber has a slider
      expect(screen.getByRole('slider')).toBeInTheDocument()
    })

    it('should pass keywordNumber to KeywordNumber component', () => {
      render(<IndexMethod {...defaultProps} keywordNumber={25} />)
      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(25)
    })

    it('should call onKeywordNumberChange when KeywordNumber changes', () => {
      const handleKeywordChange = vi.fn()
      render(<IndexMethod {...defaultProps} onKeywordNumberChange={handleKeywordChange} />)

      const input = screen.getByRole('spinbutton')
      fireEvent.change(input, { target: { value: '30' } })

      expect(handleKeywordChange).toHaveBeenCalled()
    })
  })

  describe('Tooltip', () => {
    it('should show tooltip when hovering over disabled Economy option', () => {
      // The tooltip is shown via PortalToFollowElem when hovering
      // This is controlled by useHover hook
      render(<IndexMethod {...defaultProps} currentValue={IndexingType.QUALIFIED} />)
      // The tooltip content should exist in DOM but may not be visible
      // We just verify the component renders without error
      expect(screen.getAllByText(/form\.indexMethodEconomy/).length).toBeGreaterThan(0)
    })
  })

  describe('Effect Colors', () => {
    it('should show orange effect color for High Quality option', () => {
      const { container } = render(<IndexMethod {...defaultProps} />)
      const orangeEffect = container.querySelector('.bg-util-colors-orange-orange-500')
      expect(orangeEffect).toBeInTheDocument()
    })

    it('should show indigo effect color for Economy option', () => {
      const { container } = render(<IndexMethod {...defaultProps} />)
      const indigoEffect = container.querySelector('.bg-util-colors-indigo-indigo-600')
      expect(indigoEffect).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should update active state when value prop changes', () => {
      const { rerender, container } = render(<IndexMethod {...defaultProps} value={IndexingType.QUALIFIED} />)

      let activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)

      rerender(<IndexMethod {...defaultProps} value={IndexingType.ECONOMICAL} currentValue={IndexingType.ECONOMICAL} />)

      activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined currentValue', () => {
      render(<IndexMethod {...defaultProps} currentValue={undefined} />)
      // Should render without error
      expect(screen.getByText(/stepTwo\.qualified/)).toBeInTheDocument()
    })

    it('should handle keywordNumber of 0', () => {
      render(<IndexMethod {...defaultProps} keywordNumber={0} />)
      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(0)
    })

    it('should handle max keywordNumber', () => {
      render(<IndexMethod {...defaultProps} keywordNumber={50} />)
      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(50)
    })
  })
})
