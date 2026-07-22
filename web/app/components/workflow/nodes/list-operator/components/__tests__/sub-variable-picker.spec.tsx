import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SubVariablePicker from '../sub-variable-picker'

describe('list-operator/sub-variable-picker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the placeholder and allow selecting a sub variable', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(<SubVariablePicker value="" onChange={handleChange} />)

    expect(screen.getByText('common.placeholder.select')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'name' }))

    expect(handleChange).toHaveBeenCalledWith('name')
  })

  it('should render the selected value chip and update it from the options', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(<SubVariablePicker value="size" onChange={handleChange} />)

    expect(screen.getByText('size')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'type' }))

    expect(handleChange).toHaveBeenCalledWith('type')
  })
})
