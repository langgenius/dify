import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Tooltip from '../index'

afterEach(cleanup)

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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
          <button type="button">Hover me</button>
        </Tooltip>,
      )
      expect(getByText('Hover me').textContent).toBe('Hover me')
    })

    it('should not render popup content when popupContent is empty/falsy', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      // Empty popupContent should not render the popup div
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    it('should render with triggerTestId', () => {
      render(<Tooltip popupContent="Content" triggerTestId="my-trigger" />)
      expect(screen.getByTestId('my-trigger')).toBeInTheDocument()
    })

    it('should render with asChild=false applying triggerClassName to wrapper', () => {
      const { container } = render(
        <Tooltip popupContent="Content" asChild={false} triggerClassName="my-wrapper-class">
          <span>Child</span>
        </Tooltip>,
      )
      // When asChild=false, the triggerClassName goes on PortalToFollowElemTrigger's wrapper
      expect(container.querySelector('.my-wrapper-class')).toBeInTheDocument()
    })

    it('should render with portalContentClassName', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(
        <Tooltip popupContent="Portal content" triggerClassName={triggerClassName} portalContentClassName="my-portal-class" />,
      )
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.getByText('Portal content')).toBeInTheDocument()
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
    it('should open on hover when triggerMethod is hover', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()
    })

    it('should close on mouse leave when triggerMethod is hover and needsDelay=false', () => {
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
    })

    it('should not close immediately on mouse leave when needsDelay is true', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="hover" needsDelay triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
        fireEvent.mouseLeave(trigger!)
      })
      // Still visible because of the 300ms delay
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()
    })

    it('should close after the 300ms delay when needsDelay is true and nothing is hovered', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="hover" needsDelay triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)

      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()

      act(() => {
        fireEvent.mouseLeave(trigger!)
      })
      // Still visible during the delay
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()

      // Advance past the 300ms delay
      act(() => {
        vi.advanceTimersByTime(350)
      })
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    it('should not close on click trigger when hover method is used', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="hover" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.click(trigger!)
      })
      // Click should NOT open/toggle when triggerMethod is hover
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    it('should not open on hover when triggerMethod is click', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="click" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      // Hover should NOT open when triggerMethod is click
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })
  })

  describe('Popup hover persistence', () => {
    it('should stay open when mouse moves from trigger to popup', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(
        <Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} needsDelay />,
      )
      const trigger = container.querySelector(`.${triggerClassName}`)

      // Hover the trigger to open
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()

      const popupDiv = screen.getByText('Tooltip content')

      // Leave the trigger
      act(() => {
        fireEvent.mouseLeave(trigger!)
      })

      // Enter the popup (within the 300ms window)
      act(() => {
        fireEvent.mouseEnter(popupDiv)
      })

      // Advance past delay — should still be open because popup is hovered
      act(() => {
        vi.advanceTimersByTime(350)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()
    })

    it('should close when mouse leaves the popup', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(
        <Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} needsDelay />,
      )
      const trigger = container.querySelector(`.${triggerClassName}`)

      // Open the tooltip
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      const popupDiv = screen.getByText('Tooltip content')

      // Move from trigger to popup
      act(() => {
        fireEvent.mouseLeave(trigger!)
        fireEvent.mouseEnter(popupDiv)
      })

      // Leave the popup
      act(() => {
        fireEvent.mouseLeave(popupDiv)
      })

      // Advance past delay
      act(() => {
        vi.advanceTimersByTime(350)
      })
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    it('should stay open when mouse returns to trigger before delay expires', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(
        <Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} needsDelay />,
      )
      const trigger = container.querySelector(`.${triggerClassName}`)

      // Open the tooltip
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()

      // Leave the trigger
      act(() => {
        fireEvent.mouseLeave(trigger!)
      })

      // Re-enter the trigger before the delay expires
      act(() => {
        vi.advanceTimersByTime(100)
        fireEvent.mouseEnter(trigger!)
      })

      // Advance well past delay — should still be open
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()
    })

    it('should close popup immediately when needsDelay is false and popup is left', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(
        <Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} needsDelay={false} />,
      )
      const trigger = container.querySelector(`.${triggerClassName}`)

      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()

      // Leave trigger — without needsDelay, it closes immediately
      act(() => {
        fireEvent.mouseLeave(trigger!)
      })
      // Without needsDelay, it closes immediately upon trigger leave
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })
  })

  describe('Styling and positioning', () => {
    it('should apply custom trigger className', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      expect(trigger?.className).toContain('custom-trigger')
    })

    it('should apply custom popup className', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} popupClassName="custom-popup" />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.getByText('Tooltip content').className).toContain('custom-popup')
    })

    it('should apply noDecoration when specified', () => {
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
      expect(screen.getByText('Tooltip content').className).not.toContain('bg-components-panel-bg')
    })

    it('should apply default decoration styling when noDecoration is false', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(
        <Tooltip
          popupContent="Tooltip content"
          triggerClassName={triggerClassName}
          noDecoration={false}
        />,
      )
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      const popup = screen.getByText('Tooltip content')
      expect(popup.className).toContain('bg-components-panel-bg')
      expect(popup.className).toContain('rounded-md')
    })

    it('should accept custom offset', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(
        <Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} offset={16} />,
      )
      const trigger = container.querySelector(`.${triggerClassName}`)
      expect(trigger).not.toBeNull()
    })
  })

  describe('Cleanup', () => {
    it('should clear timeout on unmount', () => {
      const triggerClassName = 'custom-trigger'
      const { container, unmount } = render(
        <Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} needsDelay />,
      )
      const trigger = container.querySelector(`.${triggerClassName}`)

      // Open and start close delay
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      act(() => {
        fireEvent.mouseLeave(trigger!)
      })

      // Unmount before delay resolves — should not throw
      unmount()

      act(() => {
        vi.advanceTimersByTime(500)
      })
    })
  })
})
