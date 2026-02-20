import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ParamItem from '.'

describe('ParamItem', () => {
  const defaultProps = {
    id: 'test_param',
    name: 'Test Param',
    value: 0.5,
    enable: true,
    max: 1,
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the parameter name', () => {
      render(<ParamItem {...defaultProps} />)

      expect(screen.getByText('Test Param')).toBeInTheDocument()
    })

    it('should render a tooltip trigger by default', () => {
      const { container } = render(<ParamItem {...defaultProps} tip="Some tip text" />)

      // Tooltip trigger icon should be rendered (the data-state div)
      expect(container.querySelector('[data-state]')).toBeInTheDocument()
    })

    it('should not render tooltip trigger when noTooltip is true', () => {
      const { container } = render(<ParamItem {...defaultProps} noTooltip tip="Hidden tip" />)

      // No tooltip trigger icon should be rendered
      expect(container.querySelector('[data-state]')).not.toBeInTheDocument()
    })

    it('should render a switch when hasSwitch is true', () => {
      render(<ParamItem {...defaultProps} hasSwitch />)

      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should not render a switch by default', () => {
      render(<ParamItem {...defaultProps} />)

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })

    it('should render InputNumber and Slider', () => {
      render(<ParamItem {...defaultProps} />)

      expect(screen.getByRole('spinbutton')).toBeInTheDocument()
      expect(screen.getByRole('slider')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<ParamItem {...defaultProps} className="my-custom-class" />)

      expect(container.firstChild).toHaveClass('my-custom-class')
    })

    it('should disable InputNumber when enable is false', () => {
      render(<ParamItem {...defaultProps} enable={false} />)

      expect(screen.getByRole('spinbutton')).toBeDisabled()
    })

    it('should disable Slider when enable is false', () => {
      render(<ParamItem {...defaultProps} enable={false} />)

      expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
    })

    it('should set switch value based on enable prop', () => {
      render(<ParamItem {...defaultProps} hasSwitch enable={true} />)

      const toggle = screen.getByRole('switch')
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })
  })

  describe('User Interactions', () => {
    it('should call onChange with id and value when InputNumber changes', async () => {
      const user = userEvent.setup()
      const StatefulParamItem = () => {
        const [value, setValue] = useState(defaultProps.value)

        return (
          <ParamItem
            {...defaultProps}
            value={value}
            onChange={(key, nextValue) => {
              defaultProps.onChange(key, nextValue)
              setValue(nextValue)
            }}
          />
        )
      }

      render(<StatefulParamItem />)
      const input = screen.getByRole('spinbutton')

      await user.clear(input)
      await user.type(input, '0.8')

      expect(defaultProps.onChange).toHaveBeenLastCalledWith('test_param', 0.8)
    })

    it('should pass scaled value to slider when max < 5', () => {
      render(<ParamItem {...defaultProps} value={0.5} />)
      const slider = screen.getByRole('slider')

      // When max < 5, slider value = value * 100 = 50
      expect(slider).toHaveAttribute('aria-valuenow', '50')
    })

    it('should pass raw value to slider when max >= 5', () => {
      render(<ParamItem {...defaultProps} value={5} max={10} />)
      const slider = screen.getByRole('slider')

      // When max >= 5, slider value = value = 5
      expect(slider).toHaveAttribute('aria-valuenow', '5')
    })

    it('should call onSwitchChange with id and value when switch is toggled', async () => {
      const user = userEvent.setup()
      const onSwitchChange = vi.fn()
      render(<ParamItem {...defaultProps} hasSwitch onSwitchChange={onSwitchChange} />)

      await user.click(screen.getByRole('switch'))

      expect(onSwitchChange).toHaveBeenCalledWith('test_param', expect.any(Boolean))
    })

    it('should call onChange with id when increment button is clicked', async () => {
      const user = userEvent.setup()
      render(<ParamItem {...defaultProps} value={0.5} step={0.1} />)
      const incrementBtn = screen.getByRole('button', { name: /increment/i })

      await user.click(incrementBtn)

      // step=0.1, so 0.5 + 0.1 = 0.6, clamped to [0,1] → 0.6
      expect(defaultProps.onChange).toHaveBeenCalledWith('test_param', 0.6)
    })
  })

  describe('Edge Cases', () => {
    it('should correctly scale slider value when max < 5', () => {
      render(<ParamItem {...defaultProps} value={0.5} min={0} />)

      // Slider should get value * 100 = 50, min * 100 = 0, max * 100 = 100
      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('aria-valuemax', '100')
    })

    it('should not scale slider value when max >= 5', () => {
      render(<ParamItem {...defaultProps} value={5} min={1} max={10} />)

      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('aria-valuemax', '10')
    })

    it('should use default step of 0.1 and min of 0 when not provided', () => {
      render(<ParamItem {...defaultProps} />)
      const input = screen.getByRole('spinbutton')

      // Component renders without error with default step/min
      expect(screen.getByRole('spinbutton')).toBeInTheDocument()
      expect(input).toHaveAttribute('step', '0.1')
      expect(input).toHaveAttribute('min', '0')
    })
  })
})
