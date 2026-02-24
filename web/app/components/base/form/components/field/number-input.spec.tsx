import { fireEvent, render, screen } from '@testing-library/react'
import NumberInputField from './number-input'

const mockField = {
  name: 'number-field',
  state: {
    value: 2,
  },
  handleChange: vi.fn(),
  handleBlur: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

describe('NumberInputField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = 2
  })

  it('should render current number value', () => {
    render(<NumberInputField label="Count" />)
    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
  })

  it('should update value when users click increment', () => {
    render(<NumberInputField label="Count" />)
    fireEvent.click(screen.getByRole('button', { name: 'increment' }))
    expect(mockField.handleChange).toHaveBeenCalledWith(3)
  })
})
