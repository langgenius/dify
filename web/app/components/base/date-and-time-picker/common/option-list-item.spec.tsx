import { fireEvent, render, screen } from '@testing-library/react'
import OptionListItem from './option-list-item'

describe('OptionListItem', () => {
  let originalScrollIntoView: Element['scrollIntoView']
  beforeEach(() => {
    vi.clearAllMocks()
    originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

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

  describe('Selection State', () => {
    it('should have selected styles when isSelected is true', () => {
      render(
        <OptionListItem isSelected={true} onClick={vi.fn()}>
          Selected
        </OptionListItem>,
      )

      const item = screen.getByRole('listitem')
      expect(item).toHaveClass('bg-components-button-ghost-bg-hover')
    })

    it('should not have selected styles when isSelected is false', () => {
      render(
        <OptionListItem isSelected={false} onClick={vi.fn()}>
          Not Selected
        </OptionListItem>,
      )

      const item = screen.getByRole('listitem')
      expect(item).not.toHaveClass('bg-components-button-ghost-bg-hover')
    })
  })

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

      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    })
  })

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

  describe('Edge Cases', () => {
    it('should handle rapid clicks without errors', () => {
      const handleClick = vi.fn()
      render(
        <OptionListItem isSelected={false} onClick={handleClick}>
          Rapid Click
        </OptionListItem>,
      )

      const item = screen.getByRole('listitem')
      fireEvent.click(item)
      fireEvent.click(item)
      fireEvent.click(item)

      expect(handleClick).toHaveBeenCalledTimes(3)
    })
  })
})
