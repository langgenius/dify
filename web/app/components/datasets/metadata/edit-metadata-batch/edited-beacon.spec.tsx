import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EditedBeacon from './edited-beacon'

describe('EditedBeacon', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render with correct size', () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)
      expect(container.firstChild).toHaveClass('size-4', 'cursor-pointer')
    })

    it('should render beacon dot by default (not hovering)', () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)
      // When not hovering, should show the small beacon dot
      const beaconDot = container.querySelector('.size-1')
      expect(beaconDot).toBeInTheDocument()
    })
  })

  describe('Hover State', () => {
    it('should show reset icon on hover', async () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)

      const wrapper = container.firstChild as HTMLElement
      fireEvent.mouseEnter(wrapper)

      await waitFor(() => {
        // On hover, should show the reset icon (RiResetLeftLine)
        const svg = container.querySelector('svg')
        expect(svg).toBeInTheDocument()
      })
    })

    it('should show beacon dot when not hovering', () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)

      // By default (not hovering), should show beacon dot
      const beaconDot = container.querySelector('.size-1.rounded-full.bg-text-accent-secondary')
      expect(beaconDot).toBeInTheDocument()
    })

    it('should hide beacon dot on hover', async () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)

      const wrapper = container.firstChild as HTMLElement
      fireEvent.mouseEnter(wrapper)

      await waitFor(() => {
        // On hover, the small beacon dot should be hidden
        const beaconDot = container.querySelector('.size-1.rounded-full.bg-text-accent-secondary')
        expect(beaconDot).not.toBeInTheDocument()
      })
    })

    it('should show beacon dot again on mouse leave', async () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)

      const wrapper = container.firstChild as HTMLElement

      // Hover
      fireEvent.mouseEnter(wrapper)

      await waitFor(() => {
        const svg = container.querySelector('svg')
        expect(svg).toBeInTheDocument()
      })

      // Leave
      fireEvent.mouseLeave(wrapper)

      await waitFor(() => {
        const beaconDot = container.querySelector('.size-1.rounded-full.bg-text-accent-secondary')
        expect(beaconDot).toBeInTheDocument()
      })
    })
  })

  describe('User Interactions', () => {
    it('should call onReset when reset button is clicked', async () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)

      const wrapper = container.firstChild as HTMLElement

      // Hover to show reset button
      fireEvent.mouseEnter(wrapper)

      await waitFor(() => {
        const resetButton = container.querySelector('.bg-text-accent-secondary')
        expect(resetButton).toBeInTheDocument()
      })

      // Find and click the reset button (the clickable element with onClick)
      const clickableElement = container.querySelector('.flex.size-4.items-center.justify-center.rounded-full.bg-text-accent-secondary')
      if (clickableElement) {
        fireEvent.click(clickableElement)
      }

      expect(handleReset).toHaveBeenCalledTimes(1)
    })

    it('should not call onReset when clicking beacon dot (not hovering)', () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)

      // Click on the wrapper when not hovering
      const wrapper = container.firstChild as HTMLElement
      fireEvent.click(wrapper)

      // onReset should not be called because we're not hovering
      expect(handleReset).not.toHaveBeenCalled()
    })
  })

  describe('Tooltip', () => {
    it('should render tooltip on hover', async () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)

      const wrapper = container.firstChild as HTMLElement
      fireEvent.mouseEnter(wrapper)

      // Tooltip should be rendered (it wraps the reset button)
      await waitFor(() => {
        const resetIcon = container.querySelector('svg')
        expect(resetIcon).toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple hover/leave cycles', async () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)

      const wrapper = container.firstChild as HTMLElement

      for (let i = 0; i < 3; i++) {
        fireEvent.mouseEnter(wrapper)
        await waitFor(() => {
          expect(container.querySelector('svg')).toBeInTheDocument()
        })

        fireEvent.mouseLeave(wrapper)
        await waitFor(() => {
          expect(container.querySelector('.size-1.rounded-full')).toBeInTheDocument()
        })
      }
    })

    it('should handle rapid hover/leave', async () => {
      const handleReset = vi.fn()
      const { container } = render(<EditedBeacon onReset={handleReset} />)

      const wrapper = container.firstChild as HTMLElement

      // Rapid hover/leave
      fireEvent.mouseEnter(wrapper)
      fireEvent.mouseLeave(wrapper)
      fireEvent.mouseEnter(wrapper)

      await waitFor(() => {
        expect(container.querySelector('svg')).toBeInTheDocument()
      })
    })
  })
})
