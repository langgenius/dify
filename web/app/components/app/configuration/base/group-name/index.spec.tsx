import { render, screen } from '@testing-library/react'
import GroupName from './index'

describe('GroupName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render name when provided', () => {
      // Arrange
      const title = 'Inputs'

      // Act
      render(<GroupName name={title} />)

      // Assert
      expect(screen.getByText(title)).toBeInTheDocument()
    })
  })
})
