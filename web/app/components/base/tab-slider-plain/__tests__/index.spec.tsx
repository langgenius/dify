import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TabSlider from '../index'

const options = [
  { value: 'overview', text: 'Overview' },
  { value: 'settings', text: 'Settings' },
]

describe('TabSlider', () => {
  it('changes only when users select an inactive tab', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TabSlider value="overview" options={options} onChange={onChange} />)

    await user.click(screen.getByText('Overview'))
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByText('Settings'))
    expect(onChange).toHaveBeenCalledWith('settings')
  })
})
