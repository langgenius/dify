import { render, screen } from '@testing-library/react'
import ContentArea from './content-area'

describe('ContentArea', () => {
  describe('Rendering', () => {
    it('should render a section container when component mounts', () => {
      // Arrange
      const { container } = render(<ContentArea />)

      // Act
      const section = container.querySelector('section')

      // Assert
      expect(section).toBeInTheDocument()
      expect(section?.tagName).toBe('SECTION')
    })
  })

  describe('Props', () => {
    it('should render child content when children are provided', () => {
      // Arrange
      const childText = 'panel-body'

      // Act
      render(
        <ContentArea>
          <span>{childText}</span>
        </ContentArea>,
      )

      // Assert
      expect(screen.getByText(childText)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render an empty section when children is undefined', () => {
      // Arrange
      const { container } = render(<ContentArea>{undefined}</ContentArea>)

      // Act
      const section = container.querySelector('section')

      // Assert
      expect(section).toBeInTheDocument()
      expect(section?.childElementCount).toBe(0)
    })
  })
})
