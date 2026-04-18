import { fireEvent, render, screen } from '@testing-library/react'
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
    fireEvent.click(screen.getByRole('button', { name: 'Increment value' }))
    expect(mockField.handleChange).toHaveBeenCalledWith(3)
  })

  it('should reset field value when users clear the input', () => {
    render(<NumberInputField label="Count" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(mockField.handleChange).toHaveBeenCalledWith(0)
  })

  it('should clamp out-of-range edits before updating field state', () => {
    render(<NumberInputField label="Count" min={0} max={10} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '12' } })

    expect(mockField.handleChange).toHaveBeenLastCalledWith(10)
  })
})
