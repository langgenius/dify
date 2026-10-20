import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ParamItem from '..'

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

  const getSlider = () =>
    screen.getByLabelText('Test Param', {
      selector: 'input[type="range"]',
    })

  describe('Rendering', () => {
    it('should not render tooltip trigger when noTooltip is true', () => {
      render(<ParamItem {...defaultProps} noTooltip tip="Hidden tip" />)

      expect(screen.queryByRole('button', { name: 'Test Param' })).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should disable InputNumber when enable is false', () => {
      render(<ParamItem {...defaultProps} enable={false} />)

      expect(screen.getByRole('textbox')).toBeDisabled()
      expect(getSlider()).toBeDisabled()
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
            onChange={(key: string, nextValue: number) => {
              defaultProps.onChange(key, nextValue)
              setValue(nextValue)
            }}
          />
        )
      }

      render(<StatefulParamItem />)
      const input = screen.getByRole('textbox')

      await user.clear(input)
      await user.type(input, '0.8')

      expect(defaultProps.onChange).toHaveBeenLastCalledWith('test_param', 0.8)
    })

    it('should reset the textbox and slider when users clear the input', async () => {
      const user = userEvent.setup()
      const StatefulParamItem = () => {
        const [value, setValue] = useState(defaultProps.value)

        return (
          <ParamItem
            {...defaultProps}
            value={value}
            onChange={(key: string, nextValue: number) => {
              defaultProps.onChange(key, nextValue)
              setValue(nextValue)
            }}
          />
        )
      }

      render(<StatefulParamItem />)

      const input = screen.getByRole('textbox')
      await user.clear(input)

      expect(defaultProps.onChange).toHaveBeenLastCalledWith('test_param', 0)
      expect(getSlider()).toHaveAttribute('aria-valuenow', '0')

      await user.tab()

      expect(input).toHaveValue('0')
    })

    it('should clamp out-of-range text edits before updating state', async () => {
      const user = userEvent.setup()
      const StatefulParamItem = () => {
        const [value, setValue] = useState(defaultProps.value)

        return (
          <ParamItem
            {...defaultProps}
            value={value}
            onChange={(key: string, nextValue: number) => {
              defaultProps.onChange(key, nextValue)
              setValue(nextValue)
            }}
          />
        )
      }

      render(<StatefulParamItem />)

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, '1.5')

      expect(defaultProps.onChange).toHaveBeenLastCalledWith('test_param', 1)
      expect(getSlider()).toHaveAttribute('aria-valuenow', '100')
    })

    it('should pass scaled value to slider when max < 5', () => {
      render(<ParamItem {...defaultProps} value={0.5} />)
      const slider = getSlider()

      // When max < 5, slider value = value * 100 = 50
      expect(slider).toHaveAttribute('aria-valuenow', '50')
      expect(slider).toHaveAttribute('max', '100')
    })

    it('should pass raw value to slider when max >= 5', () => {
      render(<ParamItem {...defaultProps} value={5} max={10} />)
      const slider = getSlider()

      // When max >= 5, slider value = value = 5
      expect(slider).toHaveAttribute('aria-valuenow', '5')
      expect(slider).toHaveAttribute('max', '10')
    })

    it('should call onSwitchChange with id and value when switch is toggled', async () => {
      const user = userEvent.setup()
      const onSwitchChange = vi.fn()
      render(<ParamItem {...defaultProps} hasSwitch onSwitchChange={onSwitchChange} />)

      await user.click(screen.getByRole('switch'))

      expect(onSwitchChange).toHaveBeenCalledWith('test_param', false)
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
})
