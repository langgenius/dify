import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NoData from './no-data'

describe('NoData', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const handleStart = vi.fn()
      const { container } = render(<NoData onStart={handleStart} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render with gradient background', () => {
      const handleStart = vi.fn()
      const { container } = render(<NoData onStart={handleStart} />)
      expect(container.firstChild).toHaveClass('rounded-xl', 'bg-gradient-to-r', 'p-4', 'pt-3')
    })

    it('should render title text', () => {
      const handleStart = vi.fn()
      const { container } = render(<NoData onStart={handleStart} />)
      // Title should have correct styling
      const title = container.querySelector('.text-xs.font-semibold')
      expect(title).toBeInTheDocument()
    })

    it('should render description text', () => {
      const handleStart = vi.fn()
      const { container } = render(<NoData onStart={handleStart} />)
      // Description should have correct styling
      const description = container.querySelector('.system-xs-regular.mt-1')
      expect(description).toBeInTheDocument()
    })

    it('should render start labeling button', () => {
      const handleStart = vi.fn()
      render(<NoData onStart={handleStart} />)
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should render arrow icon in button', () => {
      const handleStart = vi.fn()
      const { container } = render(<NoData onStart={handleStart} />)
      // RiArrowRightLine icon should be present
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should accept onStart prop', () => {
      const handleStart = vi.fn()
      render(<NoData onStart={handleStart} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onStart when button is clicked', () => {
      const handleStart = vi.fn()
      render(<NoData onStart={handleStart} />)

      fireEvent.click(screen.getByRole('button'))

      expect(handleStart).toHaveBeenCalledTimes(1)
    })

    it('should call onStart multiple times on multiple clicks', () => {
      const handleStart = vi.fn()
      render(<NoData onStart={handleStart} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(handleStart).toHaveBeenCalledTimes(3)
    })

    it('should have been called when button is clicked', () => {
      const handleStart = vi.fn()
      render(<NoData onStart={handleStart} />)

      fireEvent.click(screen.getByRole('button'))

      // The onClick handler passes the event to onStart
      expect(handleStart).toHaveBeenCalled()
    })
  })

  describe('Button Styling', () => {
    it('should have primary variant button', () => {
      const handleStart = vi.fn()
      render(<NoData onStart={handleStart} />)
      const button = screen.getByRole('button')
      // Button should have primary styling
      expect(button).toHaveClass('mt-2')
    })
  })

  describe('Layout', () => {
    it('should have correct title styling', () => {
      const handleStart = vi.fn()
      const { container } = render(<NoData onStart={handleStart} />)
      const title = container.querySelector('.text-xs.font-semibold')
      expect(title).toBeInTheDocument()
    })

    it('should have correct description styling', () => {
      const handleStart = vi.fn()
      const { container } = render(<NoData onStart={handleStart} />)
      const description = container.querySelector('.system-xs-regular.mt-1')
      expect(description).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle rapid clicks', () => {
      const handleStart = vi.fn()
      render(<NoData onStart={handleStart} />)

      const button = screen.getByRole('button')
      for (let i = 0; i < 10; i++) {
        fireEvent.click(button)
      }

      expect(handleStart).toHaveBeenCalledTimes(10)
    })
  })
})
