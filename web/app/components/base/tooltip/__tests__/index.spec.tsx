import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Tooltip from '../index'
import { tooltipManager } from '../TooltipManager'

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Tooltip', () => {
  describe('Rendering', () => {
    it('should render default tooltip with question icon', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      expect(trigger).not.toBeNull()
      expect(trigger?.querySelector('svg')).not.toBeNull() // question icon
    })

    it('should render with custom children', () => {
      const { getByText } = render(
        <Tooltip popupContent="Tooltip content">
          <button>Hover me</button>
        </Tooltip>,
      )
      expect(getByText('Hover me').textContent).toBe('Hover me')
    })

    it('should render correctly when asChild is false', () => {
      const { container } = render(
        <Tooltip popupContent="Tooltip" asChild={false} triggerClassName="custom-parent-trigger">
          <span>Trigger</span>
        </Tooltip>,
      )
      const trigger = container.querySelector('.custom-parent-trigger')
      expect(trigger).not.toBeNull()
    })

    it('should render with a fallback question icon when children are null', () => {
      const { container } = render(
        <Tooltip popupContent="Tooltip" triggerClassName="custom-fallback-trigger">
          {null}
        </Tooltip>,
      )
      const trigger = container.querySelector('.custom-fallback-trigger')
      expect(trigger).not.toBeNull()
      expect(trigger?.querySelector('svg')).not.toBeNull()
    })
  })

  describe('Disabled state', () => {
    it('should not show tooltip when disabled', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" disabled triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })
  })

  describe('Trigger methods', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('should open on hover when triggerMethod is hover', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()
    })

    it('should close on mouse leave when triggerMethod is hover and needsDelay is false', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} needsDelay={false} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
        fireEvent.mouseLeave(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    it('should toggle on click when triggerMethod is click', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="click" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.click(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()

      // Test toggle off
      act(() => {
        fireEvent.click(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    it('should do nothing on mouse enter if triggerMethod is click', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="click" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    it('should delay closing on mouse leave when needsDelay is true', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="hover" needsDelay triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)

      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.getByText('Tooltip content')).toBeInTheDocument()

      act(() => {
        fireEvent.mouseLeave(trigger!)
      })
      // Shouldn't close immediately
      expect(screen.getByText('Tooltip content')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(350)
      })
      // Should close after delay
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    it('should not close if mouse enters popup before delay finishes', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="hover" needsDelay triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)

      act(() => {
        fireEvent.mouseEnter(trigger!)
      })

      const popup = screen.getByText('Tooltip content')
      expect(popup).toBeInTheDocument()

      act(() => {
        fireEvent.mouseLeave(trigger!)
      })

      act(() => {
        vi.advanceTimersByTime(150)
        // Simulate mouse entering popup area itself during the delay timeframe
        fireEvent.mouseEnter(popup)
      })

      act(() => {
        vi.advanceTimersByTime(200) // Complete the 300ms original delay
      })

      // Should still be open because we are hovering the popup
      expect(screen.getByText('Tooltip content')).toBeInTheDocument()

      // Now mouse leaves popup
      act(() => {
        fireEvent.mouseLeave(popup)
      })

      act(() => {
        vi.advanceTimersByTime(350)
      })
      // Should now close
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    it('should do nothing on mouse enter/leave of popup when triggerMethod is not hover', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="click" needsDelay triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)

      act(() => {
        fireEvent.click(trigger!)
      })

      const popup = screen.getByText('Tooltip content')

      act(() => {
        fireEvent.mouseEnter(popup)
        fireEvent.mouseLeave(popup)
        vi.advanceTimersByTime(350)
      })

      // Should still be open because click method requires another click to close, not hover leave
      expect(screen.getByText('Tooltip content')).toBeInTheDocument()
    })

    it('should clear close timeout if trigger is hovered again before delay finishes', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="hover" needsDelay triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)

      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.getByText('Tooltip content')).toBeInTheDocument()

      act(() => {
        fireEvent.mouseLeave(trigger!)
      })

      act(() => {
        vi.advanceTimersByTime(150)
        // Re-hover trigger before it closes
        fireEvent.mouseEnter(trigger!)
      })

      act(() => {
        vi.advanceTimersByTime(200) // Original 300ms would be up
      })

      // Should still be open because we reset it
      expect(screen.getByText('Tooltip content')).toBeInTheDocument()
    })

    it('should test clear close timeout if trigger is hovered again before delay finishes and isHoverPopupRef is true', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="hover" needsDelay triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)

      act(() => {
        fireEvent.mouseEnter(trigger!)
      })

      const popup = screen.getByText('Tooltip content')
      expect(popup).toBeInTheDocument()

      act(() => {
        fireEvent.mouseEnter(popup)
        fireEvent.mouseLeave(trigger!)
      })

      act(() => {
        vi.advanceTimersByTime(350)
      })

      // Should still be open because we are hovering the popup
      expect(screen.getByText('Tooltip content')).toBeInTheDocument()
    })
  })

  describe('TooltipManager', () => {
    it('should close active tooltips when triggered centrally, overriding other closes', () => {
      const triggerClassName1 = 'custom-trigger-1'
      const triggerClassName2 = 'custom-trigger-2'

      const { container } = render(
        <div>
          <Tooltip popupContent="Tooltip content 1" triggerMethod="hover" triggerClassName={triggerClassName1} />
          <Tooltip popupContent="Tooltip content 2" triggerMethod="hover" triggerClassName={triggerClassName2} />
        </div>,
      )

      const trigger1 = container.querySelector(`.${triggerClassName1}`)
      const trigger2 = container.querySelector(`.${triggerClassName2}`)

      expect(trigger2).not.toBeNull()

      // Open first tooltip
      act(() => {
        fireEvent.mouseEnter(trigger1!)
      })
      expect(screen.queryByText('Tooltip content 1')).toBeInTheDocument()

      // TooltipManager should keep track of it
      // Next, immediately open the second one without leaving first (e.g., via TooltipManager)
      // TooltipManager registers the newest one and closes the old one when doing full external operations, but internally the manager allows direct closing

      act(() => {
        tooltipManager.closeActiveTooltip()
      })

      expect(screen.queryByText('Tooltip content 1')).not.toBeInTheDocument()

      // Safe to call again
      expect(() => tooltipManager.closeActiveTooltip()).not.toThrow()
    })
  })

  describe('Styling and positioning', () => {
    it('should apply custom trigger className', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      expect(trigger?.className).toContain('custom-trigger')
    })

    it('should pass triggerTestId to the fallback icon wrapper', () => {
      render(<Tooltip popupContent="Tooltip content" triggerTestId="test-tooltip-icon" />)
      expect(screen.getByTestId('test-tooltip-icon')).toBeInTheDocument()
    })

    it('should apply custom popup className', async () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} popupClassName="custom-popup" />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect((await screen.findByText('Tooltip content'))?.className).toContain('custom-popup')
    })

    it('should apply noDecoration when specified', async () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(
        <Tooltip
          popupContent="Tooltip content"
          triggerClassName={triggerClassName}
          noDecoration
        />,
      )
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect((await screen.findByText('Tooltip content'))?.className).not.toContain('bg-components-panel-bg')
    })
  })
})
