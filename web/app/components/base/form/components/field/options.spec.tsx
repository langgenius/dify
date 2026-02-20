import { fireEvent, render, screen } from '@testing-library/react'
import OptionsField from './options'

const mockField = {
  name: 'options-field',
  state: {
    value: [] as { label: string, value: string }[],
  },
  handleChange: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

vi.mock('@/app/components/app/configuration/config-var/config-select', () => ({
  default: ({
    onChange,
  }: {
    onChange: (value: { label: string, value: string }[]) => void
  }) => (
    <button onClick={() => onChange([{ label: 'A', value: 'a' }])}>
      apply-options
    </button>
  ),
}))

describe('OptionsField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = []
  })

  it('should render label and options control', () => {
    render(<OptionsField label="Allowed options" />)
    expect(screen.getByText('Allowed options')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'apply-options' })).toBeInTheDocument()
  })

  it('should update options when users apply changes', () => {
    render(<OptionsField label="Allowed options" />)
    fireEvent.click(screen.getByRole('button', { name: 'apply-options' }))
    expect(mockField.handleChange).toHaveBeenCalledWith([{ label: 'A', value: 'a' }])
  })
})
