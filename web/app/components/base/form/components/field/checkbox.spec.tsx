import { fireEvent, render, screen } from '@testing-library/react'
import CheckboxField from './checkbox'

const mockField = {
  name: 'checkbox-field',
  state: {
    value: false,
  },
  handleChange: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

describe('CheckboxField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should toggle on when unchecked users click the checkbox', () => {
    mockField.state.value = false
    render(<CheckboxField label="Enable feature" />)
    fireEvent.click(screen.getByTestId('checkbox-checkbox-field'))
    expect(mockField.handleChange).toHaveBeenCalledWith(true)
  })

  it('should toggle off when checked users click the label', () => {
    mockField.state.value = true
    render(<CheckboxField label="Enable feature" />)
    fireEvent.click(screen.getByText('Enable feature'))
    expect(mockField.handleChange).toHaveBeenCalledWith(false)
  })
})
