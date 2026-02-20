import { fireEvent, render, screen } from '@testing-library/react'
import NumberSliderField from './number-slider'

const mockField = {
  name: 'slider-field',
  state: {
    value: 2,
  },
  handleChange: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-number-with-slider', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: number
    onChange: (value: number) => void
  }) => (
    <button onClick={() => onChange(value + 1)}>
      {`slider-value-${value}`}
    </button>
  ),
}))

describe('NumberSliderField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = 2
  })

  it('should render description when provided', () => {
    render(<NumberSliderField label="Threshold" description="Used to control threshold" />)
    expect(screen.getByText('Used to control threshold')).toBeInTheDocument()
  })

  it('should update value when users interact with slider', () => {
    render(<NumberSliderField label="Threshold" />)
    fireEvent.click(screen.getByRole('button', { name: 'slider-value-2' }))
    expect(mockField.handleChange).toHaveBeenCalledWith(3)
  })
})
