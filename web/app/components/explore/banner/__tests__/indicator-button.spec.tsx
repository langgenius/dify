import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndicatorButton } from '../indicator-button'

describe('IndicatorButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('basic rendering', () => {
    it('renders button with correct index number', () => {
      const mockOnClick = vi.fn()
      render(
        <IndicatorButton
          index={0}
          selectedIndex={0}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText('01')).toBeInTheDocument()
    })

    it('renders two-digit index numbers', () => {
      const mockOnClick = vi.fn()
      render(
        <IndicatorButton
          index={9}
          selectedIndex={0}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('pads single digit index numbers with leading zero', () => {
      const mockOnClick = vi.fn()
      render(
        <IndicatorButton
          index={4}
          selectedIndex={0}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByText('05')).toBeInTheDocument()
    })
  })

  describe('active state', () => {
    it('applies active styles when index equals selectedIndex', () => {
      const mockOnClick = vi.fn()
      render(
        <IndicatorButton
          index={2}
          selectedIndex={2}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-text-primary')
    })

    it('applies inactive styles when index does not equal selectedIndex', () => {
      const mockOnClick = vi.fn()
      render(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-components-panel-on-panel-item-bg')
    })
  })

  describe('click handling', () => {
    it('calls onClick when button is clicked', () => {
      const mockOnClick = vi.fn()
      render(
        <IndicatorButton
          index={0}
          selectedIndex={0}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      fireEvent.click(screen.getByRole('button'))
      expect(mockOnClick).toHaveBeenCalledTimes(1)
    })

    it('stops event propagation when clicked', () => {
      const mockOnClick = vi.fn()
      const mockParentClick = vi.fn()

      render(
        <div onClick={mockParentClick}>
          <IndicatorButton
            index={0}
            selectedIndex={0}
            isNextSlide={false}
            autoplayDelay={5000}
            resetKey={0}
            isPaused={false}
            onClick={mockOnClick}
          />
        </div>,
      )

      fireEvent.click(screen.getByRole('button'))
      expect(mockOnClick).toHaveBeenCalledTimes(1)
      expect(mockParentClick).not.toHaveBeenCalled()
    })
  })

  describe('progress indicator', () => {
    it('does not show progress indicator when not next slide', () => {
      const mockOnClick = vi.fn()
      const { container } = render(
        <IndicatorButton
          index={0}
          selectedIndex={0}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      const progressIndicator = container.querySelector('[style*="conic-gradient"]')
      expect(progressIndicator).not.toBeInTheDocument()
    })

    it('shows progress indicator when isNextSlide is true and not active', () => {
      const mockOnClick = vi.fn()
      const { container } = render(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      const progressIndicator = container.querySelector('[style*="conic-gradient"]')
      expect(progressIndicator).toBeInTheDocument()
    })

    it('does not show progress indicator when isNextSlide but also active', () => {
      const mockOnClick = vi.fn()
      const { container } = render(
        <IndicatorButton
          index={0}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      const progressIndicator = container.querySelector('[style*="conic-gradient"]')
      expect(progressIndicator).not.toBeInTheDocument()
    })
  })

  describe('animation behavior', () => {
    it('starts progress from 0 when isNextSlide becomes true', () => {
      const mockOnClick = vi.fn()
      const { container, rerender } = render(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      expect(container.querySelector('[style*="conic-gradient"]')).not.toBeInTheDocument()

      rerender(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      expect(container.querySelector('[style*="conic-gradient"]')).toBeInTheDocument()
    })

    it('resets progress when resetKey changes', () => {
      const mockOnClick = vi.fn()
      const { rerender, container } = render(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      const progressIndicator = container.querySelector('[style*="conic-gradient"]')
      expect(progressIndicator).toBeInTheDocument()

      rerender(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={1}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      const newProgressIndicator = container.querySelector('[style*="conic-gradient"]')
      expect(newProgressIndicator).toBeInTheDocument()
    })

    it('stops animation when isPaused is true', () => {
      const mockOnClick = vi.fn()
      const mockRequestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')

      render(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={true}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByRole('button')).toBeInTheDocument()
      mockRequestAnimationFrame.mockRestore()
    })

    it('cancels animation frame on unmount', () => {
      const mockOnClick = vi.fn()
      const mockCancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')

      const { unmount } = render(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      act(() => {
        vi.advanceTimersToNextTimer()
      })

      unmount()

      expect(mockCancelAnimationFrame).toHaveBeenCalled()
      mockCancelAnimationFrame.mockRestore()
    })

    it('cancels animation frame when isNextSlide becomes false', () => {
      const mockOnClick = vi.fn()
      const mockCancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')

      const { rerender } = render(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      act(() => {
        vi.advanceTimersToNextTimer()
      })

      rerender(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      expect(mockCancelAnimationFrame).toHaveBeenCalled()
      mockCancelAnimationFrame.mockRestore()
    })

    it('continues polling when document is hidden', () => {
      const mockOnClick = vi.fn()
      const mockRequestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')

      Object.defineProperty(document, 'hidden', {
        writable: true,
        configurable: true,
        value: true,
      })

      render(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByRole('button')).toBeInTheDocument()

      Object.defineProperty(document, 'hidden', {
        writable: true,
        configurable: true,
        value: false,
      })

      mockRequestAnimationFrame.mockRestore()
    })
  })

  describe('isPaused prop default', () => {
    it('defaults isPaused to false when not provided', () => {
      const mockOnClick = vi.fn()
      const { container } = render(
        <IndicatorButton
          index={1}
          selectedIndex={0}
          isNextSlide={true}
          autoplayDelay={5000}
          resetKey={0}
          onClick={mockOnClick}
        />,
      )

      expect(container.querySelector('[style*="conic-gradient"]')).toBeInTheDocument()
    })
  })

  describe('button styling', () => {
    it('has correct base classes', () => {
      const mockOnClick = vi.fn()
      render(
        <IndicatorButton
          index={0}
          selectedIndex={1}
          isNextSlide={false}
          autoplayDelay={5000}
          resetKey={0}
          isPaused={false}
          onClick={mockOnClick}
        />,
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('relative')
      expect(button).toHaveClass('flex')
      expect(button).toHaveClass('items-center')
      expect(button).toHaveClass('justify-center')
      expect(button).toHaveClass('rounded-[7px]')
      expect(button).toHaveClass('border')
      expect(button).toHaveClass('transition-colors')
    })
  })
})
