import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InputTypeSelectField from '../index'

const mockField = {
  name: 'input-type',
  state: {
    value: 'text-input',
  },
  handleChange: vi.fn(),
}

vi.mock('../../../..', () => ({
  useFieldContext: () => mockField,
}))

describe('InputTypeSelectField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = 'text-input'
  })

  it('should render label and selected option', () => {
    const { container } = render(<InputTypeSelectField label="Input type" supportFile={true} />)

    expect(screen.getByText('Input type')).toBeInTheDocument()
    expect(screen.getByText('appDebug.variableConfig.text-input')).toBeInTheDocument()
    expect(container.querySelector('[role="combobox"] span > div')).not.toBeInTheDocument()
    expect(container.querySelector('[role="combobox"] > span > span')).toHaveClass('flex', 'min-w-0', 'items-center', 'gap-x-0.5')
  })

  it('should update value when users choose another input type', async () => {
    const user = userEvent.setup()
    render(<InputTypeSelectField label="Input type" supportFile={true} />)

    await user.click(screen.getByRole('combobox', { name: 'Input type' }))
    await user.click(screen.getByRole('option', { name: /appDebug.variableConfig.number/ }))

    expect(mockField.handleChange).toHaveBeenCalledWith('number')
  })
})
