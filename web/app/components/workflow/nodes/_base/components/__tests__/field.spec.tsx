import { fireEvent, render, screen } from '@testing-library/react'
import Field from '../field'

describe('Field', () => {
  it('should toggle folded children when supportFold is enabled', () => {
    render(
      <Field title="Foldable" supportFold>
        <div>folded content</div>
      </Field>,
    )

    expect(screen.queryByText('folded content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Foldable').closest('.cursor-pointer')!)
    expect(screen.getByText('folded content')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Foldable').closest('.cursor-pointer')!)
    expect(screen.queryByText('folded content')).not.toBeInTheDocument()
  })
})
