import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SubVariablePicker from '../sub-variable-picker'

describe('list-operator/sub-variable-picker', () => {
  it('should render the placeholder and allow selecting a sub variable', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(<SubVariablePicker value="" onChange={handleChange} />)

    expect(screen.getByText('common.placeholder.select')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'name' }))

    expect(handleChange).toHaveBeenCalledWith('name')
  })
})
