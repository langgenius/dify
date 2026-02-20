import { fireEvent, render, screen } from '@testing-library/react'
import VariableSelectorField from './variable-selector'

const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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

  afterAll(() => {
    consoleSpy.mockRestore()
  })

  it('should render label and variable picker', () => {
    render(<VariableSelectorField label="Reference variable" />)
    expect(screen.getByText('Reference variable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Variable picker' })).toBeInTheDocument()
  })

  it('should trigger variable change handler on pick', () => {
    render(<VariableSelectorField label="Reference variable" />)
    fireEvent.click(screen.getByRole('button', { name: 'Variable picker' }))
    expect(consoleSpy).toHaveBeenCalledWith('Variable value changed')
  })
})
