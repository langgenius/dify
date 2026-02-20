import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TopKItem from './top-k-item'

vi.mock('@/env', () => ({
  env: {
    NEXT_PUBLIC_TOP_K_MAX_VALUE: 10,
  },
}))

describe('TopKItem', () => {
  const defaultProps = {
    value: 2,
    enable: true,
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the translated parameter name', () => {
      render(<TopKItem {...defaultProps} />)

      expect(screen.getByText('appDebug.datasetConfig.top_k')).toBeInTheDocument()
    })

    it('should render tooltip trigger', () => {
      const { container } = render(<TopKItem {...defaultProps} />)

      // Tooltip trigger icon should be rendered
      expect(container.querySelector('[data-state]')).toBeInTheDocument()
    })

    it('should render InputNumber and Slider', () => {
      render(<TopKItem {...defaultProps} />)

      expect(screen.getByRole('spinbutton')).toBeInTheDocument()
      expect(screen.getByRole('slider')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<TopKItem {...defaultProps} className="custom-cls" />)

      expect(container.firstChild).toHaveClass('custom-cls')
    })

    it('should disable controls when enable is false', () => {
      render(<TopKItem {...defaultProps} enable={false} />)

      expect(screen.getByRole('spinbutton')).toBeDisabled()
      expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Value Limits', () => {
    it('should use step of 1', () => {
      render(<TopKItem {...defaultProps} />)
      const input = screen.getByRole('spinbutton')

      expect(input).toHaveAttribute('step', '1')
    })

    it('should use minimum of 1', () => {
      render(<TopKItem {...defaultProps} />)
      const input = screen.getByRole('spinbutton')

      expect(input).toHaveAttribute('min', '1')
    })

    it('should use maximum from env (10)', () => {
      render(<TopKItem {...defaultProps} />)
      const input = screen.getByRole('spinbutton')

      expect(input).toHaveAttribute('max', '10')
    })

    it('should render slider with max >= 5 so no scaling is applied', () => {
      render(<TopKItem {...defaultProps} />)
      const slider = screen.getByRole('slider')

      // max=10 >= 5 so slider shows raw values
      expect(slider).toHaveAttribute('aria-valuemax', '10')
    })

    it('should not render a switch (no hasSwitch prop)', () => {
      render(<TopKItem {...defaultProps} />)

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onChange with clamped integer value via increment button', async () => {
      const user = userEvent.setup()
      render(<TopKItem {...defaultProps} value={5} />)
      const incrementBtn = screen.getByRole('button', { name: /increment/i })

      await user.click(incrementBtn)

      // step=1, so 5 + 1 = 6, clamped to [1,10] → 6
      expect(defaultProps.onChange).toHaveBeenCalledWith('top_k', 6)
    })

    it('should call onChange with clamped integer value via decrement button', async () => {
      const user = userEvent.setup()
      render(<TopKItem {...defaultProps} value={5} />)
      const decrementBtn = screen.getByRole('button', { name: /decrement/i })

      await user.click(decrementBtn)

      // step=1, so 5 - 1 = 4, clamped to [1,10] → 4
      expect(defaultProps.onChange).toHaveBeenCalledWith('top_k', 4)
    })

    it('should call onChange with integer value when slider changes', async () => {
      const user = userEvent.setup()
      render(<TopKItem {...defaultProps} value={2} />)
      const slider = screen.getByRole('slider')

      await user.click(slider)
      await user.keyboard('{ArrowRight}')

      expect(defaultProps.onChange).toHaveBeenLastCalledWith('top_k', 3)
    })
  })
})
