import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ScoreThresholdItem from './score-threshold-item'

describe('ScoreThresholdItem', () => {
  const defaultProps = {
    value: 0.7,
    enable: true,
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the translated parameter name', () => {
      render(<ScoreThresholdItem {...defaultProps} />)

      expect(screen.getByText('appDebug.datasetConfig.score_threshold')).toBeInTheDocument()
    })

    it('should render tooltip trigger', () => {
      const { container } = render(<ScoreThresholdItem {...defaultProps} />)

      // Tooltip trigger icon should be rendered
      expect(container.querySelector('[data-state]')).toBeInTheDocument()
    })

    it('should render InputNumber and Slider', () => {
      render(<ScoreThresholdItem {...defaultProps} />)

      expect(screen.getByRole('spinbutton')).toBeInTheDocument()
      expect(screen.getByRole('slider')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<ScoreThresholdItem {...defaultProps} className="custom-cls" />)

      expect(container.firstChild).toHaveClass('custom-cls')
    })

    it('should render switch when hasSwitch is true', () => {
      render(<ScoreThresholdItem {...defaultProps} hasSwitch />)

      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should forward onSwitchChange to ParamItem', async () => {
      const onSwitchChange = vi.fn()
      render(<ScoreThresholdItem {...defaultProps} hasSwitch onSwitchChange={onSwitchChange} />)

      // Verify the switch rendered (onSwitchChange forwarded internally)
      expect(screen.getByRole('switch')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('switch'))
      expect(onSwitchChange).toHaveBeenCalledTimes(1)
    })

    it('should disable controls when enable is false', () => {
      render(<ScoreThresholdItem {...defaultProps} enable={false} />)

      expect(screen.getByRole('spinbutton')).toBeDisabled()
      expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Value Clamping', () => {
    it('should clamp values to minimum of 0', () => {
      render(<ScoreThresholdItem {...defaultProps} />)
      const input = screen.getByRole('spinbutton')

      expect(input).toHaveAttribute('min', '0')
    })

    it('should clamp values to maximum of 1', () => {
      render(<ScoreThresholdItem {...defaultProps} />)
      const input = screen.getByRole('spinbutton')

      expect(input).toHaveAttribute('max', '1')
    })

    it('should use step of 0.01', () => {
      render(<ScoreThresholdItem {...defaultProps} />)
      const input = screen.getByRole('spinbutton')

      expect(input).toHaveAttribute('step', '0.01')
    })

    it('should call onChange with rounded value when input changes', async () => {
      const user = userEvent.setup()
      const StatefulScoreThresholdItem = () => {
        const [value, setValue] = useState(defaultProps.value)

        return (
          <ScoreThresholdItem
            {...defaultProps}
            value={value}
            onChange={(key, nextValue) => {
              defaultProps.onChange(key, nextValue)
              setValue(nextValue)
            }}
          />
        )
      }

      render(<StatefulScoreThresholdItem />)
      const input = screen.getByRole('spinbutton')

      await user.clear(input)
      await user.type(input, '0.55')

      expect(defaultProps.onChange).toHaveBeenLastCalledWith('score_threshold', 0.55)
    })

    it('should call onChange with clamped value via increment button', async () => {
      const user = userEvent.setup()
      render(<ScoreThresholdItem {...defaultProps} value={0.5} />)
      const incrementBtn = screen.getByRole('button', { name: /increment/i })

      await user.click(incrementBtn)

      // step=0.01, so 0.5 + 0.01 = 0.51, clamped to [0,1] → 0.51
      expect(defaultProps.onChange).toHaveBeenCalledWith('score_threshold', 0.51)
    })

    it('should call onChange with clamped value via decrement button', async () => {
      const user = userEvent.setup()
      render(<ScoreThresholdItem {...defaultProps} value={0.5} />)
      const decrementBtn = screen.getByRole('button', { name: /decrement/i })

      await user.click(decrementBtn)

      expect(defaultProps.onChange).toHaveBeenCalledWith('score_threshold', 0.49)
    })

    it('should clamp to max=1 when value exceeds maximum', () => {
      render(<ScoreThresholdItem {...defaultProps} value={1.5} />)
      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(1)
    })
  })
})
