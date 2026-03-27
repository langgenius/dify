import { render, screen } from '@testing-library/react'
import Field from '../field'

describe('ConfigModal Field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers the required field label rendering.
  describe('Rendering', () => {
    it('should render the field title and children content', () => {
      render(
        <Field title="Field Title">
          <div>Child content</div>
        </Field>,
      )

      expect(screen.getByText('Field Title')).toBeInTheDocument()
      expect(screen.getByText('Child content')).toBeInTheDocument()
    })

    it('should render the optional indicator when the field is optional', () => {
      render(
        <Field title="Optional Title" isOptional>
          <div>Optional content</div>
        </Field>,
      )

      expect(screen.getByText('Optional Title')).toBeInTheDocument()
      expect(screen.getByText(/\(appDebug\.variableConfig\.optional\)/)).toBeInTheDocument()
    })
  })
})
