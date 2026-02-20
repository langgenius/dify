import { fireEvent, render, screen } from '@testing-library/react'
import VariableOrConstantInputField from './variable-or-constant-input'

const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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

  afterAll(() => {
    consoleSpy.mockRestore()
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

  it('should trigger constant change handler when users type value', () => {
    render(<VariableOrConstantInputField label="Input source" />)
    fireEvent.click(screen.getAllByRole('button')[1])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'constant-value' } })
    expect(consoleSpy).toHaveBeenCalledWith('Constant value changed:', 'constant-value')
  })

  it('should trigger variable handler when users select variable', () => {
    render(<VariableOrConstantInputField label="Input source" />)
    fireEvent.click(screen.getByRole('button', { name: 'Variable picker' }))
    expect(consoleSpy).toHaveBeenCalledWith('Variable value changed')
  })
})
