import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NumberInputField from '../number-input'

const mockField = {
  name: 'number-field',
  state: {
    value: 2,
  },
  handleChange: vi.fn(),
  handleBlur: vi.fn(),
}

vi.mock('../../..', () => ({
  useFieldContext: () => mockField,
}))

describe('NumberInputField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = 2
  })

  it('should render current number value', () => {
    render(<NumberInputField label="Count" />)
    expect(screen.getByRole('textbox')).toHaveValue('2')
  })

  it('should update value when users click increment', () => {
    render(<NumberInputField label="Count" />)
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.increment' }))
    expect(mockField.handleChange).toHaveBeenCalledWith(3)
  })

  it('should reset field value when users clear the input', () => {
    render(<NumberInputField label="Count" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(mockField.handleChange).toHaveBeenCalledWith(0)
  })

  it('should preserve out-of-range edits before blur', async () => {
    const user = userEvent.setup()
    render(<NumberInputField label="Count" min={0} max={10} />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '12')

    expect(mockField.handleChange).toHaveBeenLastCalledWith(12)
  })
})
