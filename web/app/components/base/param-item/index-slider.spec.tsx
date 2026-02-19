import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParamItem from '.'

describe('ParamItem Slider onChange', () => {
  const defaultProps = {
    id: 'test_param',
    name: 'Test Param',
    enable: true,
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should divide slider value by 100 when max < 5', async () => {
    const user = userEvent.setup()
    render(<ParamItem {...defaultProps} value={0.5} min={0} max={1} />)
    const slider = screen.getByRole('slider')

    await user.click(slider)
    await user.keyboard('{ArrowRight}')

    // max=1 < 5, so slider value change (50->51) becomes 0.51
    expect(defaultProps.onChange).toHaveBeenLastCalledWith('test_param', 0.51)
  })

  it('should not divide slider value when max >= 5', async () => {
    const user = userEvent.setup()
    render(<ParamItem {...defaultProps} value={5} min={1} max={10} />)
    const slider = screen.getByRole('slider')

    await user.click(slider)
    await user.keyboard('{ArrowRight}')

    // max=10 >= 5, so value remains raw (5->6)
    expect(defaultProps.onChange).toHaveBeenLastCalledWith('test_param', 6)
  })
})
