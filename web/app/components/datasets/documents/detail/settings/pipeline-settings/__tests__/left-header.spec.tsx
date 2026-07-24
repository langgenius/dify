import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LeftHeader from '../left-header'

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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<LeftHeader title="Test Title" />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the title', () => {
      render(<LeftHeader title="My Document Title" />)

      expect(screen.getByText('My Document Title')).toBeInTheDocument()
    })

    it('should render the process documents text', () => {
      render(<LeftHeader title="Test" />)

      // Assert - i18n key format
      expect(screen.getByText(/addDocuments\.steps\.processDocuments/i)).toBeInTheDocument()
    })

    it('should render back button', () => {
      render(<LeftHeader title="Test" />)

      const backButton = screen.getByRole('button')
      expect(backButton).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call router.back when back button is clicked', () => {
      render(<LeftHeader title="Test" />)

      const backButton = screen.getByRole('button')
      fireEvent.click(backButton)

      expect(mockBack).toHaveBeenCalledTimes(1)
    })

    it('should call router.back multiple times on multiple clicks', () => {
      render(<LeftHeader title="Test" />)

      const backButton = screen.getByRole('button')
      fireEvent.click(backButton)
      fireEvent.click(backButton)

      expect(mockBack).toHaveBeenCalledTimes(2)
    })
  })

  describe('Props', () => {
    it('should render different titles', () => {
      const { rerender } = render(<LeftHeader title="First Title" />)
      expect(screen.getByText('First Title')).toBeInTheDocument()

      rerender(<LeftHeader title="Second Title" />)

      expect(screen.getByText('Second Title')).toBeInTheDocument()
    })
  })

  // Styling tests
  describe('Styling', () => {
    it('should have back button with proper styling', () => {
      render(<LeftHeader title="Test" />)

      const backButton = screen.getByRole('button')
      expect(backButton).toHaveClass('absolute')
      expect(backButton).toHaveClass('rounded-full')
    })

    it('should render title with gradient background styling', () => {
      const { container } = render(<LeftHeader title="Test" />)

      const titleElement = container.querySelector('.bg-pipeline-add-documents-title-bg')
      expect(titleElement).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have aria-label on back button', () => {
      render(<LeftHeader title="Test" />)

      const backButton = screen.getByRole('button')
      expect(backButton).toHaveAttribute('aria-label')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty title', () => {
      const { container } = render(<LeftHeader title="" />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender } = render(<LeftHeader title="Test" />)

      rerender(<LeftHeader title="Updated Test" />)

      expect(screen.getByText('Updated Test')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
