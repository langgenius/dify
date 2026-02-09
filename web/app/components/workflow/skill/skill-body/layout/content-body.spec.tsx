import { render, screen } from '@testing-library/react'
import ContentBody from './content-body'

describe('ContentBody', () => {
  describe('Rendering', () => {
    it('should render a container element when component mounts', () => {
      // Arrange
      const { container } = render(<ContentBody />)

      // Act
      const body = container.querySelector('div')

      // Assert
      expect(body).toBeInTheDocument()
      expect(body?.tagName).toBe('DIV')
    })
  })

  describe('Props', () => {
    it('should render child content when children are provided', () => {
      // Arrange
      const childText = 'content-panel'

      // Act
      render(
        <ContentBody>
          <span>{childText}</span>
        </ContentBody>,
      )

      // Assert
      expect(screen.getByText(childText)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render an empty container when children is null', () => {
      // Arrange
      const { container } = render(<ContentBody>{null}</ContentBody>)

      // Act
      const body = container.querySelector('div')

      // Assert
      expect(body).toBeInTheDocument()
      expect(body?.childElementCount).toBe(0)
    })
  })
})
