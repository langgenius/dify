import { render, screen } from '@testing-library/react'
import SkillPageLayout from './skill-page-layout'

describe('SkillPageLayout', () => {
  describe('Rendering', () => {
    it('should render a root container when component mounts', () => {
      // Arrange
      const { container } = render(<SkillPageLayout />)

      // Act
      const layout = container.querySelector('div')

      // Assert
      expect(layout).toBeInTheDocument()
      expect(layout?.tagName).toBe('DIV')
    })
  })

  describe('Props', () => {
    it('should render child panels when children are provided', () => {
      // Arrange
      const leftText = 'left-panel'
      const rightText = 'right-panel'

      // Act
      render(
        <SkillPageLayout>
          <span>{leftText}</span>
          <span>{rightText}</span>
        </SkillPageLayout>,
      )

      // Assert
      expect(screen.getByText(leftText)).toBeInTheDocument()
      expect(screen.getByText(rightText)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render an empty container when no children are provided', () => {
      // Arrange
      const { container } = render(<SkillPageLayout />)

      // Act
      const layout = container.querySelector('div')

      // Assert
      expect(layout).toBeInTheDocument()
      expect(layout?.childElementCount).toBe(0)
    })
  })
})
