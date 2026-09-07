import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import TextAreaField from '../text-area'

const mockField = {
  name: 'text-area-field',
  state: {
    value: 'Initial note',
  },
  handleChange: vi.fn(),
  handleBlur: vi.fn(),
}

vi.mock('../../..', () => ({
  useFieldContext: () => mockField,
}))

describe('TextAreaField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = 'Initial note'
  })

  it('should render current value', () => {
    render(<TextAreaField label="Note" />)
    expect(screen.getByLabelText('Note')).toHaveValue('Initial note')
  })

  it('should update value when users type', () => {
    render(<TextAreaField label="Note" />)
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Updated note' } })
    expect(mockField.handleChange).toHaveBeenCalledWith('Updated note')
  })

  it('should keep form writeback when external props contain onValueChange', () => {
    const externalOnValueChange = vi.fn()

    render(
      <TextAreaField
        label="Note"
        {...({ onValueChange: externalOnValueChange } as Partial<
          ComponentProps<typeof TextAreaField>
        >)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Updated note' } })

    expect(mockField.handleChange).toHaveBeenCalledWith('Updated note')
    expect(externalOnValueChange).not.toHaveBeenCalled()
  })
})
