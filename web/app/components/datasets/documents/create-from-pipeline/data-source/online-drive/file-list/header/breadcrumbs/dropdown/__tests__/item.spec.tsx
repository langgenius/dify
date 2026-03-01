import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Item from '../item'

describe('Item', () => {
  const defaultProps = {
    name: 'Documents',
    index: 2,
    onBreadcrumbClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verify the breadcrumb name is displayed
  describe('Rendering', () => {
    it('should render breadcrumb name', () => {
      render(<Item {...defaultProps} />)

      expect(screen.getByText('Documents')).toBeInTheDocument()
    })
  })

  // User interactions: clicking triggers callback with correct index
  describe('User Interactions', () => {
    it('should call onBreadcrumbClick with correct index on click', () => {
      render(<Item {...defaultProps} />)

      fireEvent.click(screen.getByText('Documents'))

      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledOnce()
      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledWith(2)
    })

    it('should pass different index values correctly', () => {
      render(<Item {...defaultProps} index={5} />)

      fireEvent.click(screen.getByText('Documents'))

      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledWith(5)
    })
  })
})
