import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TabSliderNew from '../index'

describe('TabSliderNew', () => {
  it('selects a tab', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TabSliderNew
        value="all"
        options={[
          { value: 'all', text: 'All' },
          { value: 'active', text: 'Active' },
        ]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByText('Active'))

    expect(onChange).toHaveBeenCalledWith('active')
  })
})
