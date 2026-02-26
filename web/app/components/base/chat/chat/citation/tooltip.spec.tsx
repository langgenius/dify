import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import Tooltip from './tooltip'

const renderTooltip = (data: number | string = 42, text = 'Characters', icon = <span data-testid="mock-icon">icon</span>) =>
  render(<Tooltip data={data} text={text} icon={icon} />)

describe('Tooltip', () => {
  describe('Rendering', () => {
    it('should render the trigger content wrapper', () => {
      renderTooltip()
      expect(screen.getByTestId('tooltip-trigger-content')).toBeInTheDocument()
    })

    it('should render the icon inside the trigger', () => {
      renderTooltip(42, 'Characters', <span data-testid="mock-icon">icon</span>)
      expect(screen.getByTestId('mock-icon')).toBeInTheDocument()
    })

    it('should render a numeric data value in the trigger', () => {
      renderTooltip(123)
      expect(screen.getByTestId('tooltip-trigger-content')).toHaveTextContent('123')
    })

    it('should render a string data value in the trigger', () => {
      renderTooltip('abc123')
      expect(screen.getByTestId('tooltip-trigger-content')).toHaveTextContent('abc123')
    })

    it('should not render the tooltip popup before hovering', () => {
      renderTooltip()
      expect(screen.queryByTestId('tooltip-popup')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should render the provided text label when tooltip is open', async () => {
      const user = userEvent.setup()
      renderTooltip(10, 'Word Count')

      await user.hover(screen.getByTestId('tooltip-trigger-content'))

      expect(screen.getByTestId('tooltip-popup')).toHaveTextContent('Word Count')
    })

    it('should render the data value inside the tooltip popup', async () => {
      const user = userEvent.setup()
      renderTooltip(99, 'Hit Count')

      await user.hover(screen.getByTestId('tooltip-trigger-content'))

      expect(screen.getByTestId('tooltip-popup')).toHaveTextContent('99')
    })

    it('should render a string data value inside the tooltip popup', async () => {
      const user = userEvent.setup()
      renderTooltip('abc1234', 'Vector Hash')

      await user.hover(screen.getByTestId('tooltip-trigger-content'))

      expect(screen.getByTestId('tooltip-popup')).toHaveTextContent('abc1234')
    })

    it('should render both text and data together inside the tooltip popup', async () => {
      const user = userEvent.setup()
      renderTooltip(55, 'Characters')

      await user.hover(screen.getByTestId('tooltip-trigger-content'))

      const popup = screen.getByTestId('tooltip-popup')
      expect(popup).toHaveTextContent('Characters')
      expect(popup).toHaveTextContent('55')
    })

    it('should render any arbitrary ReactNode as icon', () => {
      render(<Tooltip data={1} text="text" icon={<div data-testid="custom-icon">★</div>} />)
      expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    })

    it('should update displayed data when prop changes', () => {
      const { rerender } = render(<Tooltip data={10} text="Words" icon={<span />} />)
      expect(screen.getByTestId('tooltip-trigger-content')).toHaveTextContent('10')

      rerender(<Tooltip data={20} text="Words" icon={<span />} />)
      expect(screen.getByTestId('tooltip-trigger-content')).toHaveTextContent('20')
    })

    it('should update displayed text in popup when prop changes and tooltip is open', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<Tooltip data={10} text="Original" icon={<span />} />)
      await user.hover(screen.getByTestId('tooltip-trigger-content'))
      expect(screen.getByTestId('tooltip-popup')).toHaveTextContent('Original')

      rerender(<Tooltip data={10} text="Updated" icon={<span />} />)
      expect(screen.getByTestId('tooltip-popup')).toHaveTextContent('Updated')
    })
  })

  describe('Tooltip Visibility', () => {
    it('should show the tooltip popup on mouse enter', async () => {
      const user = userEvent.setup()
      renderTooltip()

      await user.hover(screen.getByTestId('tooltip-trigger-content'))

      expect(screen.getByTestId('tooltip-popup')).toBeInTheDocument()
    })

    it('should hide the tooltip popup on mouse leave', async () => {
      const user = userEvent.setup()
      renderTooltip()

      await user.hover(screen.getByTestId('tooltip-trigger-content'))
      await user.unhover(screen.getByTestId('tooltip-trigger-content'))

      expect(screen.queryByTestId('tooltip-popup')).not.toBeInTheDocument()
    })

    it('should re-show tooltip after hover → unhover → hover cycle', async () => {
      const user = userEvent.setup()
      renderTooltip()

      await user.hover(screen.getByTestId('tooltip-trigger-content'))
      await user.unhover(screen.getByTestId('tooltip-trigger-content'))
      await user.hover(screen.getByTestId('tooltip-trigger-content'))

      expect(screen.getByTestId('tooltip-popup')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render without crashing when data is 0', () => {
      expect(() => render(<Tooltip data={0} text="score" icon={<span />} />)).not.toThrow()
    })

    it('should render without crashing when data is an empty string', () => {
      expect(() => render(<Tooltip data="" text="label" icon={<span />} />)).not.toThrow()
    })

    it('should render without crashing when text is an empty string', () => {
      expect(() => render(<Tooltip data={1} text="" icon={<span />} />)).not.toThrow()
    })

    it('should keep tooltip closed without any interaction', () => {
      renderTooltip(0.5)
      expect(screen.queryByTestId('tooltip-popup')).not.toBeInTheDocument()
    })

    it('should render data value 0 in the trigger', () => {
      render(<Tooltip data={0} text="score" icon={<span />} />)
      expect(screen.getByTestId('tooltip-trigger-content')).toHaveTextContent('0')
    })
  })
})
