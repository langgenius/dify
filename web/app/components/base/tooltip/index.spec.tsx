import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import Tooltip from './index'

afterEach(cleanup)

describe('Tooltip', () => {
  describe('Rendering', () => {
    test('should render default tooltip with question icon', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      expect(trigger).not.toBeNull()
      expect(trigger?.querySelector('svg')).not.toBeNull() // question icon
    })

    test('should render with custom children', () => {
      const { getByText } = render(
        <Tooltip popupContent="Tooltip content">
          <button>Hover me</button>
        </Tooltip>,
      )
      expect(getByText('Hover me').textContent).toBe('Hover me')
    })
  })

  describe('Disabled state', () => {
    test('should not show tooltip when disabled', () => {
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
    test('should open on hover when triggerMethod is hover', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()
    })

    test('should close on mouse leave when triggerMethod is hover', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} needsDelay={false} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
        fireEvent.mouseLeave(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument()
    })

    test('should toggle on click when triggerMethod is click', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="click" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.click(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()
    })

    test('should not close immediately on mouse leave when needsDelay is true', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerMethod="hover" needsDelay triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
        fireEvent.mouseLeave(trigger!)
      })
      expect(screen.queryByText('Tooltip content')).toBeInTheDocument()
    })
  })

  describe('Styling and positioning', () => {
    test('should apply custom trigger className', () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      expect(trigger?.className).toContain('custom-trigger')
    })

    test('should apply custom popup className', async () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip popupContent="Tooltip content" triggerClassName={triggerClassName} popupClassName="custom-popup" />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect((await screen.findByText('Tooltip content'))?.className).toContain('custom-popup')
    })

    test('should apply noDecoration when specified', async () => {
      const triggerClassName = 'custom-trigger'
      const { container } = render(<Tooltip
        popupContent="Tooltip content"
        triggerClassName={triggerClassName}
        noDecoration
      />)
      const trigger = container.querySelector(`.${triggerClassName}`)
      act(() => {
        fireEvent.mouseEnter(trigger!)
      })
      expect((await screen.findByText('Tooltip content'))?.className).not.toContain('bg-components-panel-bg')
    })
  })
})
