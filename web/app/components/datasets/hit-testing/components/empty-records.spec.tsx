import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmptyRecords from './empty-records'

describe('EmptyRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the empty state component
  describe('Rendering', () => {
    it('should render the "no recent" tip text', () => {
      // Arrange & Act
      render(<EmptyRecords />)

      // Assert
      expect(screen.getByText(/noRecentTip/i)).toBeInTheDocument()
    })

    it('should render the history icon', () => {
      // Arrange & Act
      const { container } = render(<EmptyRecords />)

      // Assert
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render inside a styled container', () => {
      // Arrange & Act
      const { container } = render(<EmptyRecords />)

      // Assert
      const wrapper = container.firstElementChild
      expect(wrapper?.className).toContain('rounded-2xl')
      expect(wrapper?.className).toContain('bg-workflow-process-bg')
    })
  })
})
