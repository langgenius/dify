import { fireEvent, render, screen } from '@testing-library/react'
import VariableSelectorField from './variable-selector'

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange }: { onChange?: () => void }) => (
    <button onClick={() => onChange?.()}>
      Variable picker
    </button>
  ),
}))

describe('VariableSelectorField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render label and variable picker', () => {
    render(<VariableSelectorField label="Reference variable" />)
    expect(screen.getByText('Reference variable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Variable picker' })).toBeInTheDocument()
  })

  it('should keep picker available after users pick a variable', () => {
    render(<VariableSelectorField label="Reference variable" />)
    const pickerButton = screen.getByRole('button', { name: 'Variable picker' })
    fireEvent.click(pickerButton)
    expect(pickerButton).toBeInTheDocument()
  })
})
