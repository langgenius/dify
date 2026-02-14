import { fireEvent, render, screen } from '@testing-library/react'
import OptionListItem from './option-list-item'

describe('OptionListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock scrollIntoView since jsdom doesn't implement it
    Element.prototype.scrollIntoView = vi.fn()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render children content', () => {
      render(
        <OptionListItem isSelected={false} onClick={vi.fn()}>
          Test Item
        </OptionListItem>,
      )

      expect(screen.getByText('Test Item')).toBeInTheDocument()
    })

    it('should render as a list item element', () => {
      render(
        <OptionListItem isSelected={false} onClick={vi.fn()}>
          Item
        </OptionListItem>,
      )

      expect(screen.getByRole('listitem')).toBeInTheDocument()
    })
  })

  // Selection styling tests
  describe('Selection State', () => {
    it('should apply selected background class when isSelected is true', () => {
      render(
        <OptionListItem isSelected={true} onClick={vi.fn()}>
          Selected
        </OptionListItem>,
      )

      const item = screen.getByRole('listitem')
      expect(item.className).toContain('bg-components-button-ghost-bg-hover')
    })

    it('should apply hover-only class when isSelected is false', () => {
      render(
        <OptionListItem isSelected={false} onClick={vi.fn()}>
          Not Selected
        </OptionListItem>,
      )

      const item = screen.getByRole('listitem')
      expect(item.className).toContain('hover:bg-components-button-ghost-bg-hover')
    })
  })

  // Auto-scroll behavior tests
  describe('Auto-Scroll', () => {
    it('should scroll into view on mount when isSelected is true', () => {
      render(
        <OptionListItem isSelected={true} onClick={vi.fn()}>
          Selected
        </OptionListItem>,
      )

      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant' })
    })

    it('should not scroll into view on mount when isSelected is false', () => {
      render(
        <OptionListItem isSelected={false} onClick={vi.fn()}>
          Not Selected
        </OptionListItem>,
      )

      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    })

    it('should not scroll into view on mount when noAutoScroll is true', () => {
      render(
        <OptionListItem isSelected={true} noAutoScroll onClick={vi.fn()}>
          No Scroll
        </OptionListItem>,
      )

      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalledWith({ behavior: 'instant' })
    })
  })

  // Click behavior tests
  describe('Click Behavior', () => {
    it('should call onClick when clicked', () => {
      const handleClick = vi.fn()
      render(
        <OptionListItem isSelected={false} onClick={handleClick}>
          Clickable
        </OptionListItem>,
      )

      fireEvent.click(screen.getByRole('listitem'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should scroll into view with smooth behavior on click', () => {
      render(
        <OptionListItem isSelected={false} onClick={vi.fn()}>
          Item
        </OptionListItem>,
      )

      fireEvent.click(screen.getByRole('listitem'))

      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
    })
  })
})
