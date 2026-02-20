import { fireEvent, render, screen } from '@testing-library/react'
import InputTypeSelectField from './index'

const mockField = {
  name: 'input-type',
  state: {
    value: 'text-input',
  },
  handleChange: vi.fn(),
}

vi.mock('../../..', () => ({
  useFieldContext: () => mockField,
}))

describe('InputTypeSelectField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = 'text-input'
  })

  it('should render label and selected option', () => {
    render(<InputTypeSelectField label="Input type" supportFile={true} />)

    expect(screen.getByText('Input type')).toBeInTheDocument()
    expect(screen.getByText('appDebug.variableConfig.text-input')).toBeInTheDocument()
  })

  it('should update value when users choose another input type', () => {
    render(<InputTypeSelectField label="Input type" supportFile={true} />)

    fireEvent.click(screen.getByText('appDebug.variableConfig.text-input'))
    fireEvent.click(screen.getByText('appDebug.variableConfig.number'))

    expect(mockField.handleChange).toHaveBeenCalledWith('number')
  })
})
