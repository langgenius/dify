import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SelectField from '../select'

const mockField = {
  name: 'select-field',
  state: {
    value: 'alpha',
  },
  handleChange: vi.fn(),
}

vi.mock('../../..', () => ({
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
    expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveTextContent('Alpha')
  })

  it('should render the option label when selected value is an empty string', () => {
    mockField.state.value = ''

    render(
      <SelectField
        label="Mode"
        options={[
          { label: 'No default selected', value: '' },
          { label: 'Alpha', value: 'alpha' },
        ]}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveTextContent('No default selected')
  })

  it('should update value when users select another option', async () => {
    const user = userEvent.setup()
    render(
      <SelectField
        label="Mode"
        options={[
          { label: 'Alpha', value: 'alpha' },
          { label: 'Beta', value: 'beta' },
        ]}
      />,
    )
    await user.click(screen.getByRole('combobox', { name: 'Mode' }))
    await user.click(screen.getByRole('option', { name: 'Beta' }))
    expect(mockField.handleChange).toHaveBeenCalledWith('beta')
  })
})
