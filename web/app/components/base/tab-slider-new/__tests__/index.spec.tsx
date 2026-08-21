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

    expect(screen.getByRole('radiogroup', { name: 'Tool categories' })).toBeInTheDocument()

    const allOption = screen.getByRole('radio', { name: 'All' })
    const activeOption = screen.getByRole('radio', { name: 'Active' })

    expect(allOption).toHaveAttribute('aria-checked', 'true')
    expect(activeOption).toHaveAttribute('aria-checked', 'false')

    await user.click(allOption)
    expect(onChange).not.toHaveBeenCalled()

    allOption.focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith('active')
  })
})
