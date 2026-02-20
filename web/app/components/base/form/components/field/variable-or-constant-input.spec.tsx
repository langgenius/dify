import { fireEvent, render, screen } from '@testing-library/react'
import VariableOrConstantInputField from './variable-or-constant-input'

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange }: { onChange?: () => void }) => (
    <button onClick={() => onChange?.()}>
      Variable picker
    </button>
  ),
}))

describe('VariableOrConstantInputField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render variable picker by default', () => {
    render(<VariableOrConstantInputField label="Input source" />)
    expect(screen.getByRole('button', { name: 'Variable picker' })).toBeInTheDocument()
  })

  it('should switch to constant input when users choose constant', () => {
    render(<VariableOrConstantInputField label="Input source" />)
    fireEvent.click(screen.getAllByRole('button')[1])
    expect(screen.queryByRole('button', { name: 'Variable picker' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('should show typed constant value in the input', () => {
    render(<VariableOrConstantInputField label="Input source" />)
    fireEvent.click(screen.getAllByRole('button')[1])
    const textbox = screen.getByRole('textbox')
    fireEvent.change(textbox, { target: { value: 'constant-value' } })
    expect(textbox).toHaveValue('constant-value')
  })

  it('should switch back to variable mode when users choose variable again', () => {
    render(<VariableOrConstantInputField label="Input source" />)
    const modeButtons = screen.getAllByRole('button')

    fireEvent.click(modeButtons[1])
    expect(screen.getByRole('textbox')).toBeInTheDocument()

    fireEvent.click(modeButtons[0])
    expect(screen.getByRole('button', { name: 'Variable picker' })).toBeInTheDocument()
  })
})
