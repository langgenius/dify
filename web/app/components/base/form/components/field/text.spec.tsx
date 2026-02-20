import { fireEvent, render, screen } from '@testing-library/react'
import TextField from './text'

const mockField = {
  name: 'text-field',
  state: {
    value: 'Initial text',
  },
  handleChange: vi.fn(),
  handleBlur: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

describe('TextField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = 'Initial text'
  })

  it('should render current value', () => {
    render(<TextField label="Name" />)
    expect(screen.getByLabelText('Name')).toHaveValue('Initial text')
  })

  it('should update value when users type', () => {
    render(<TextField label="Name" />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated text' } })
    expect(mockField.handleChange).toHaveBeenCalledWith('Updated text')
  })
})
