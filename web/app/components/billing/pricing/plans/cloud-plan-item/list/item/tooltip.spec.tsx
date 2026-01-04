import { render, screen } from '@testing-library/react'
import Tooltip from './tooltip'

describe('Tooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering the info tooltip container
  describe('Rendering', () => {
    it('should render the content panel when provide with text', () => {
      // Arrange
      const content = 'Usage resets on the first day of every month.'

      // Act
      render(<Tooltip content={content} />)

      // Assert
      expect(() => screen.getByText(content)).not.toThrow()
    })
  })

  describe('Icon rendering', () => {
    it('should render the icon when provided with content', () => {
      // Arrange
      const content = 'Tooltips explain each plan detail.'

      // Act
      render(<Tooltip content={content} />)

      // Assert
      expect(screen.getByTestId('tooltip-icon')).toBeInTheDocument()
    })
  })

  // Handling empty strings while keeping structure consistent
  describe('Edge cases', () => {
    it('should render without crashing when passed empty content', () => {
      // Arrange
      const content = ''

      // Act and Assert
      expect(() => render(<Tooltip content={content} />)).not.toThrow()
    })
  })
})
