import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ProgressTooltip from './progress-tooltip'

describe('ProgressTooltip', () => {
  describe('Rendering', () => {
    it('should render the trigger content', () => {
      render(<ProgressTooltip data={0.75} />)
      expect(screen.getByTestId('progress-trigger-content')).toBeInTheDocument()
    })

    it('should render the data value in the trigger', () => {
      render(<ProgressTooltip data={0.75} />)
      expect(screen.getByTestId('progress-trigger-content')).toHaveTextContent('0.75')
    })

    it('should render the progress bar fill element', () => {
      render(<ProgressTooltip data={0.5} />)
      expect(screen.getByTestId('progress-bar-fill')).toBeInTheDocument()
    })

    it('should not render the tooltip popup before hovering', () => {
      render(<ProgressTooltip data={0.5} />)
      expect(screen.queryByTestId('progress-tooltip-popup')).not.toBeInTheDocument()
    })
  })

  describe('Progress Bar Width', () => {
    it('should set fill width to data * 100 percent', () => {
      render(<ProgressTooltip data={0.75} />)
      expect(screen.getByTestId('progress-bar-fill')).toHaveStyle({ width: '75%' })
    })

    it('should set fill width to 0% when data is 0', () => {
      render(<ProgressTooltip data={0} />)
      expect(screen.getByTestId('progress-bar-fill')).toHaveStyle({ width: '0%' })
    })

    it('should set fill width to 100% when data is 1', () => {
      render(<ProgressTooltip data={1} />)
      expect(screen.getByTestId('progress-bar-fill')).toHaveStyle({ width: '100%' })
    })

    it('should set fill width to 50% when data is 0.5', () => {
      render(<ProgressTooltip data={0.5} />)
      expect(screen.getByTestId('progress-bar-fill')).toHaveStyle({ width: '50%' })
    })
  })

  describe('Tooltip Visibility', () => {
    it('should show the tooltip popup on mouse enter', async () => {
      const user = userEvent.setup()
      render(<ProgressTooltip data={0.8} />)

      await user.hover(screen.getByTestId('progress-trigger-content'))

      expect(screen.getByTestId('progress-tooltip-popup')).toBeInTheDocument()
    })

    it('should hide the tooltip popup on mouse leave', async () => {
      const user = userEvent.setup()
      render(<ProgressTooltip data={0.8} />)

      await user.hover(screen.getByTestId('progress-trigger-content'))
      await user.unhover(screen.getByTestId('progress-trigger-content'))

      expect(screen.queryByTestId('progress-tooltip-popup')).not.toBeInTheDocument()
    })

    it('should show the hitScore i18n key in the tooltip', async () => {
      const user = userEvent.setup()
      render(<ProgressTooltip data={0.8} />)

      await user.hover(screen.getByTestId('progress-trigger-content'))

      expect(screen.getByTestId('progress-tooltip-popup')).toHaveTextContent(/hitScore/i)
    })

    it('should show the data value inside the tooltip popup', async () => {
      const user = userEvent.setup()
      render(<ProgressTooltip data={0.8} />)

      await user.hover(screen.getByTestId('progress-trigger-content'))

      expect(screen.getByTestId('progress-tooltip-popup')).toHaveTextContent('0.8')
    })
  })

  describe('Props', () => {
    it('should render correctly with a small fractional value', () => {
      render(<ProgressTooltip data={0.12} />)
      expect(screen.getByTestId('progress-bar-fill').getAttribute('style')).toMatch(/width:\s*12/)
      expect(screen.getByTestId('progress-trigger-content')).toHaveTextContent('0.12')
    })

    it('should render correctly with a value close to 1', () => {
      render(<ProgressTooltip data={0.99} />)
      expect(screen.getByTestId('progress-bar-fill')).toHaveStyle({ width: '99%' })
    })

    it('should update displayed data when prop changes', () => {
      const { rerender } = render(<ProgressTooltip data={0.3} />)
      expect(screen.getByTestId('progress-trigger-content')).toHaveTextContent('0.3')

      rerender(<ProgressTooltip data={0.9} />)
      expect(screen.getByTestId('progress-trigger-content')).toHaveTextContent('0.9')
      expect(screen.getByTestId('progress-bar-fill')).toHaveStyle({ width: '90%' })
    })
  })

  describe('Edge Cases', () => {
    it('should render without crashing when data is exactly 0', () => {
      expect(() => render(<ProgressTooltip data={0} />)).not.toThrow()
    })

    it('should render without crashing when data is exactly 1', () => {
      expect(() => render(<ProgressTooltip data={1} />)).not.toThrow()
    })

    it('should re-show tooltip after hover → unhover → hover cycle', async () => {
      const user = userEvent.setup()
      render(<ProgressTooltip data={0.5} />)

      await user.hover(screen.getByTestId('progress-trigger-content'))
      await user.unhover(screen.getByTestId('progress-trigger-content'))
      await user.hover(screen.getByTestId('progress-trigger-content'))

      expect(screen.getByTestId('progress-tooltip-popup')).toBeInTheDocument()
    })

    it('should keep tooltip closed without any interaction', () => {
      render(<ProgressTooltip data={0.42} />)
      expect(screen.queryByTestId('progress-tooltip-popup')).not.toBeInTheDocument()
    })

    it('should not call any external handlers by default', () => {
      const consoleError = vi.spyOn(console, 'error')
      render(<ProgressTooltip data={0.5} />)
      expect(consoleError).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })
  })
})
