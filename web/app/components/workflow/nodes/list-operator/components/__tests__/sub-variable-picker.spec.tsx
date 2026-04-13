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

    render(
      <SubVariablePicker
        value=""
        onChange={handleChange}
      />,
    )

    expect(screen.getByText('common.placeholder.select')).toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('option', { name: 'name' }))

    expect(handleChange).toHaveBeenCalledWith('name')
  })

  it('should render the selected value chip and keep the wrapper class name', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    const { container } = render(
      <SubVariablePicker
        value="size"
        onChange={handleChange}
        className="custom-sub-variable"
      />,
    )

    expect(container.firstChild).toHaveClass('custom-sub-variable')
    expect(screen.getByText('size')).toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('option', { name: 'type' }))

    expect(handleChange).toHaveBeenCalledWith('type')
  })
})
