import { fireEvent, render, screen } from '@testing-library/react'
import Field from '../field'

describe('Field', () => {
  it('should render subtitle styling, tooltip, operations, warning dot and required marker', () => {
    const { container } = render(
      <Field
        title="Knowledge"
        tooltip="tooltip text"
        operations={<button type="button">operation</button>}
        required
        warningDot
        isSubTitle
      />,
    )

    expect(screen.getByText('Knowledge')).toBeInTheDocument()
    expect(screen.getByLabelText('tooltip text')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'operation' })).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(container.querySelector('.system-xs-medium-uppercase')).not.toBeNull()
    expect(container.querySelector('.bg-text-warning-secondary')).not.toBeNull()
  })

  it('should toggle folded children when supportFold is enabled', () => {
    const { container } = render(
      <Field title="Foldable" supportFold>
        <div>folded content</div>
      </Field>,
    )

    expect(screen.queryByText('folded content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Foldable').closest('.cursor-pointer')!)
    expect(screen.getByText('folded content')).toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveStyle({ transform: 'rotate(0deg)' })

    fireEvent.click(screen.getByText('Foldable').closest('.cursor-pointer')!)
    expect(screen.queryByText('folded content')).not.toBeInTheDocument()
  })

  it('should render inline children without folding support', () => {
    const { container } = render(
      <Field title="Inline" inline>
        <div>always visible</div>
      </Field>,
    )

    expect(screen.getByText('always visible')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('flex')
  })
})
