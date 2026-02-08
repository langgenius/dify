import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LeftHeader from './left-header'

// Mock next/navigation
const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockBack,
  }),
}))

describe('LeftHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<LeftHeader title="Test Title" />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the title', () => {
      // Arrange & Act
      render(<LeftHeader title="My Document Title" />)

      // Assert
      expect(screen.getByText('My Document Title')).toBeInTheDocument()
    })

    it('should render the process documents text', () => {
      // Arrange & Act
      render(<LeftHeader title="Test" />)

      // Assert - i18n key format
      expect(screen.getByText(/addDocuments\.steps\.processDocuments/i)).toBeInTheDocument()
    })

    it('should render back button', () => {
      // Arrange & Act
      render(<LeftHeader title="Test" />)

      // Assert
      const backButton = screen.getByRole('button')
      expect(backButton).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call router.back when back button is clicked', () => {
      // Arrange
      render(<LeftHeader title="Test" />)

      // Act
      const backButton = screen.getByRole('button')
      fireEvent.click(backButton)

      // Assert
      expect(mockBack).toHaveBeenCalledTimes(1)
    })

    it('should call router.back multiple times on multiple clicks', () => {
      // Arrange
      render(<LeftHeader title="Test" />)

      // Act
      const backButton = screen.getByRole('button')
      fireEvent.click(backButton)
      fireEvent.click(backButton)

      // Assert
      expect(mockBack).toHaveBeenCalledTimes(2)
    })
  })

  // Props tests
  describe('Props', () => {
    it('should render different titles', () => {
      // Arrange
      const { rerender } = render(<LeftHeader title="First Title" />)
      expect(screen.getByText('First Title')).toBeInTheDocument()

      // Act
      rerender(<LeftHeader title="Second Title" />)

      // Assert
      expect(screen.getByText('Second Title')).toBeInTheDocument()
    })
  })

  // Styling tests
  describe('Styling', () => {
    it('should have back button with proper styling', () => {
      // Arrange & Act
      render(<LeftHeader title="Test" />)

      // Assert
      const backButton = screen.getByRole('button')
      expect(backButton).toHaveClass('absolute')
      expect(backButton).toHaveClass('rounded-full')
    })

    it('should render title with gradient background styling', () => {
      // Arrange & Act
      const { container } = render(<LeftHeader title="Test" />)

      // Assert
      const titleElement = container.querySelector('.bg-pipeline-add-documents-title-bg')
      expect(titleElement).toBeInTheDocument()
    })
  })

  // Accessibility tests
  describe('Accessibility', () => {
    it('should have aria-label on back button', () => {
      // Arrange & Act
      render(<LeftHeader title="Test" />)

      // Assert
      const backButton = screen.getByRole('button')
      expect(backButton).toHaveAttribute('aria-label')
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty title', () => {
      // Arrange & Act
      const { container } = render(<LeftHeader title="" />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(<LeftHeader title="Test" />)

      // Act
      rerender(<LeftHeader title="Updated Test" />)

      // Assert
      expect(screen.getByText('Updated Test')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
