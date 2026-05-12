import { render, screen } from '@testing-library/react'
import Field from '../field'

describe('ConfigModal Field', () => {
  it('should render the title and children', () => {
    render(
      <Field title="Field title">
        <input aria-label="field-input" />
      </Field>,
    )

    expect(screen.getByText('Field title')).toBeInTheDocument()
    expect(screen.getByLabelText('field-input')).toBeInTheDocument()
  })

  it('should render the optional hint when requested', () => {
    render(
      <Field title="Optional field" isOptional>
        <input aria-label="optional-field-input" />
      </Field>,
    )

    expect(screen.getByText(/\(appDebug\.variableConfig\.optional\)/)).toBeInTheDocument()
  })
})
