import { render, screen } from '@testing-library/react'
import FeaturePanel from './index'

describe('FeaturePanel', () => {
  // Rendering behavior for standard layout.
  describe('Rendering', () => {
    it('should render the title and children when provided', () => {
      // Arrange
      render(
        <FeaturePanel title="Panel Title">
          <div>Panel Body</div>
        </FeaturePanel>,
      )

      // Assert
      expect(screen.getByText('Panel Title')).toBeInTheDocument()
      expect(screen.getByText('Panel Body')).toBeInTheDocument()
    })
  })

  // Prop-driven presentation details like icons, actions, and spacing.
  describe('Props', () => {
    it('should render header icon and right slot and apply header border', () => {
      // Arrange
      render(
        <FeaturePanel
          title="Feature"
          headerIcon={<span>Icon</span>}
          headerRight={<button type="button">Action</button>}
          hasHeaderBottomBorder={true}
        />,
      )

      // Assert
      expect(screen.getByText('Icon')).toBeInTheDocument()
      expect(screen.getByText('Action')).toBeInTheDocument()
      const header = screen.getByText('Feature').parentElement?.parentElement?.parentElement
      expect(header).toHaveClass('border-b')
    })

    it('should apply custom className and remove padding when noBodySpacing is true', () => {
      // Arrange
      const { container } = render(
        <FeaturePanel title="Spacing" className="custom-panel" noBodySpacing={true}>
          <div>Body</div>
        </FeaturePanel>,
      )

      // Assert
      const root = container.firstElementChild as HTMLElement
      expect(root).toHaveClass('custom-panel')
      expect(root).toHaveClass('pb-0')
      const body = screen.getByText('Body').parentElement as HTMLElement
      expect(body.className).not.toContain('mt-1')
    })
  })

  // Edge cases when optional content is missing.
  describe('Edge Cases', () => {
    it('should not render the body wrapper when children is undefined', () => {
      // Arrange
      render(<FeaturePanel title="No Body" />)

      // Assert
      expect(screen.queryByText('No Body')).toBeInTheDocument()
      expect(screen.queryByText('Panel Body')).not.toBeInTheDocument()
    })
  })
})
