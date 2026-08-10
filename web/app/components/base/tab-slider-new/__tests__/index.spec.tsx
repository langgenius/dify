import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TabSliderNew from '../index'

describe('TabSliderNew', () => {
  it('exposes and changes the selected tool category', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TabSliderNew
        ariaLabel="Tool categories"
        value="all"
        options={[
          { value: 'all', text: 'All' },
          { value: 'active', text: 'Active' },
        ]}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('group', { name: 'Tool categories' })).toBeInTheDocument()

    const allButton = screen.getByRole('button', { name: 'All' })
    const activeButton = screen.getByRole('button', { name: 'Active' })

    expect(allButton).toHaveAttribute('aria-pressed', 'true')
    expect(activeButton).toHaveAttribute('aria-pressed', 'false')

    await user.click(allButton)
    expect(onChange).not.toHaveBeenCalled()

    activeButton.focus()
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('active')
  })
})
