import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmptyRecords from '../empty-records'

describe('EmptyRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the empty state component
  describe('Rendering', () => {
    it('should render the "no recent" tip text', () => {
      render(<EmptyRecords />)

      expect(screen.getByText(/noRecentTip/i)).toBeInTheDocument()
    })

    it('should render the history icon', () => {
      const { container } = render(<EmptyRecords />)

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render inside a styled container', () => {
      const { container } = render(<EmptyRecords />)

      const wrapper = container.firstElementChild
      expect(wrapper?.className).toContain('rounded-2xl')
      expect(wrapper?.className).toContain('bg-workflow-process-bg')
    })
  })
})
