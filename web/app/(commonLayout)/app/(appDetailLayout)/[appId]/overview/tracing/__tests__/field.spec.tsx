import { fireEvent, render, screen } from '@testing-library/react'
import Field from '../field'

describe('OverviewRouteTracingField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render label, placeholder, and required marker', () => {
    render(
      <Field
        label="API Key"
        value=""
        placeholder="Enter token"
        isRequired={true}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('API Key')).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter token')).toBeInTheDocument()
  })

  it('should forward input changes as plain string values', () => {
    const onChange = vi.fn()

    render(
      <Field
        label="Endpoint"
        value=""
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com' } })

    expect(onChange).toHaveBeenCalledWith('https://example.com')
  })
})
