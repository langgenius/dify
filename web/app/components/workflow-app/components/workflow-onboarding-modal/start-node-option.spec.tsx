import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import StartNodeOption from './start-node-option'

describe('StartNodeOption', () => {
  const mockOnClick = vi.fn()
  const defaultProps = {
    icon: <div data-testid="test-icon">Icon</div>,
    title: 'Test Title',
    description: 'Test description for the option',
    onClick: mockOnClick,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper function to render component
  const renderComponent = (props = {}) => {
    return render(<StartNodeOption {...defaultProps} {...props} />)
  }

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('should render icon correctly', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
      expect(screen.getByText('Icon')).toBeInTheDocument()
    })

    it('should render title correctly', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const title = screen.getByText('Test Title')
      expect(title).toBeInTheDocument()
      expect(title).toHaveClass('system-md-semi-bold')
      expect(title).toHaveClass('text-text-primary')
    })

    it('should render description correctly', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const description = screen.getByText('Test description for the option')
      expect(description).toBeInTheDocument()
      expect(description).toHaveClass('system-xs-regular')
      expect(description).toHaveClass('text-text-tertiary')
    })

    it('should be rendered as a clickable card', () => {
      // Arrange & Act
      const { container } = renderComponent()

      // Assert
      const card = container.querySelector('.cursor-pointer')
      expect(card).toBeInTheDocument()
      // Check that it has cursor-pointer class to indicate clickability
      expect(card).toHaveClass('cursor-pointer')
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should render with subtitle when provided', () => {
      // Arrange & Act
      renderComponent({ subtitle: 'Optional Subtitle' })

      // Assert
      expect(screen.getByText('Optional Subtitle')).toBeInTheDocument()
    })

    it('should not render subtitle when not provided', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      const titleElement = screen.getByText('Test Title').parentElement
      expect(titleElement).not.toHaveTextContent('Optional Subtitle')
    })

    it('should render subtitle with correct styling', () => {
      // Arrange & Act
      renderComponent({ subtitle: 'Subtitle Text' })

      // Assert
      const subtitle = screen.getByText('Subtitle Text')
      expect(subtitle).toHaveClass('system-md-regular')
      expect(subtitle).toHaveClass('text-text-quaternary')
    })

    it('should render custom icon component', () => {
      // Arrange
      const customIcon = <svg data-testid="custom-svg">Custom</svg>

      // Act
      renderComponent({ icon: customIcon })

      // Assert
      expect(screen.getByTestId('custom-svg')).toBeInTheDocument()
    })

    it('should render long title correctly', () => {
      // Arrange
      const longTitle = 'This is a very long title that should still render correctly'

      // Act
      renderComponent({ title: longTitle })

      // Assert
      expect(screen.getByText(longTitle)).toBeInTheDocument()
    })

    it('should render long description correctly', () => {
      // Arrange
      const longDescription = 'This is a very long description that explains the option in great detail and should still render correctly within the component layout'

      // Act
      renderComponent({ description: longDescription })

      // Assert
      expect(screen.getByText(longDescription)).toBeInTheDocument()
    })

    it('should render with proper layout structure', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText('Test Title')).toBeInTheDocument()
      expect(screen.getByText('Test description for the option')).toBeInTheDocument()
      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onClick when card is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const card = screen.getByText('Test Title').closest('div[class*="cursor-pointer"]')
      await user.click(card!)

      // Assert
      expect(mockOnClick).toHaveBeenCalledTimes(1)
    })

    it('should call onClick when icon is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const icon = screen.getByTestId('test-icon')
      await user.click(icon)

      // Assert
      expect(mockOnClick).toHaveBeenCalledTimes(1)
    })

    it('should call onClick when title is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const title = screen.getByText('Test Title')
      await user.click(title)

      // Assert
      expect(mockOnClick).toHaveBeenCalledTimes(1)
    })

    it('should call onClick when description is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const description = screen.getByText('Test description for the option')
      await user.click(description)

      // Assert
      expect(mockOnClick).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple rapid clicks', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const card = screen.getByText('Test Title').closest('div[class*="cursor-pointer"]')
      await user.click(card!)
      await user.click(card!)
      await user.click(card!)

      // Assert
      expect(mockOnClick).toHaveBeenCalledTimes(3)
    })

    it('should not throw error if onClick is undefined', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ onClick: undefined })

      // Act & Assert
      const card = screen.getByText('Test Title').closest('div[class*="cursor-pointer"]')
      await expect(user.click(card!)).resolves.not.toThrow()
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle empty string title', () => {
      // Arrange & Act
      renderComponent({ title: '' })

      // Assert
      const titleContainer = screen.getByText('Test description for the option').parentElement?.parentElement
      expect(titleContainer).toBeInTheDocument()
    })

    it('should handle empty string description', () => {
      // Arrange & Act
      renderComponent({ description: '' })

      // Assert
      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('should handle undefined subtitle gracefully', () => {
      // Arrange & Act
      renderComponent({ subtitle: undefined })

      // Assert
      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('should handle empty string subtitle', () => {
      // Arrange & Act
      renderComponent({ subtitle: '' })

      // Assert
      // Empty subtitle should still render but be empty
      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('should handle null subtitle', () => {
      // Arrange & Act
      renderComponent({ subtitle: null })

      // Assert
      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('should render with subtitle containing special characters', () => {
      // Arrange
      const specialSubtitle = '(optional) - [Beta]'

      // Act
      renderComponent({ subtitle: specialSubtitle })

      // Assert
      expect(screen.getByText(specialSubtitle)).toBeInTheDocument()
    })

    it('should render with title and subtitle together', () => {
      // Arrange & Act
      const { container } = renderComponent({
        title: 'Main Title',
        subtitle: 'Secondary Text',
      })

      // Assert
      expect(screen.getByText('Main Title')).toBeInTheDocument()
      expect(screen.getByText('Secondary Text')).toBeInTheDocument()

      // Both should be in the same heading element
      const heading = container.querySelector('h3')
      expect(heading).toHaveTextContent('Main Title')
      expect(heading).toHaveTextContent('Secondary Text')
    })
  })

  // Accessibility Tests
  describe('Accessibility', () => {
    it('should have semantic heading structure', () => {
      // Arrange & Act
      const { container } = renderComponent()

      // Assert
      const heading = container.querySelector('h3')
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveTextContent('Test Title')
    })

    it('should have semantic paragraph for description', () => {
      // Arrange & Act
      const { container } = renderComponent()

      // Assert
      const paragraph = container.querySelector('p')
      expect(paragraph).toBeInTheDocument()
      expect(paragraph).toHaveTextContent('Test description for the option')
    })

    it('should have proper cursor style for accessibility', () => {
      // Arrange & Act
      const { container } = renderComponent()

      // Assert
      const card = container.querySelector('.cursor-pointer')
      expect(card).toBeInTheDocument()
      expect(card).toHaveClass('cursor-pointer')
    })
  })

  // Additional Edge Cases
  describe('Additional Edge Cases', () => {
    it('should handle click when onClick handler is missing', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ onClick: undefined })

      // Act & Assert - Should not throw error
      const card = screen.getByText('Test Title').closest('div[class*="cursor-pointer"]')
      await expect(user.click(card!)).resolves.not.toThrow()
    })
  })
})
