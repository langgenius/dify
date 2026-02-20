import { fireEvent, render, screen } from '@testing-library/react'
import CustomSelectField from './custom-select'

const mockField = {
  name: 'custom-select-field',
  state: {
    value: 'small',
  },
  handleChange: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

describe('CustomSelectField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = 'small'
  })

  it('should render select placeholder or selected value', () => {
    render(
      <CustomSelectField
        label="Size"
        options={[
          { label: 'Small', value: 'small' },
          { label: 'Large', value: 'large' },
        ]}
      />,
    )
    expect(screen.getByText('Small')).toBeInTheDocument()
  })

  it('should update value when users select another option', () => {
    render(
      <CustomSelectField
        label="Size"
        options={[
          { label: 'Small', value: 'small' },
          { label: 'Large', value: 'large' },
        ]}
      />,
    )
    fireEvent.click(screen.getByText('Small'))
    fireEvent.click(screen.getByText('Large'))
    expect(mockField.handleChange).toHaveBeenCalledWith('large')
  })
})
