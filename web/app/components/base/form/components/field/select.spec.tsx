import { fireEvent, render, screen } from '@testing-library/react'
import SelectField from './select'

const mockField = {
  name: 'select-field',
  state: {
    value: 'alpha',
  },
  handleChange: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

describe('SelectField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = 'alpha'
  })

  it('should render selected value', () => {
    render(
      <SelectField
        label="Mode"
        options={[
          { label: 'Alpha', value: 'alpha' },
          { label: 'Beta', value: 'beta' },
        ]}
      />,
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('should update value when users select another option', () => {
    render(
      <SelectField
        label="Mode"
        options={[
          { label: 'Alpha', value: 'alpha' },
          { label: 'Beta', value: 'beta' },
        ]}
      />,
    )
    fireEvent.click(screen.getByText('Alpha'))
    fireEvent.click(screen.getByText('Beta'))
    expect(mockField.handleChange).toHaveBeenCalledWith('beta')
  })
})
