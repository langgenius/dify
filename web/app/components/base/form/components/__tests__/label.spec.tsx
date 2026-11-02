import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Label from '../label'

describe('Label', () => {
  const defaultProps = {
    htmlFor: 'test-input',
    label: 'Test Label',
  }

  it('should show optional text when the field is not required', () => {
    render(<Label {...defaultProps} showOptional />)
    expect(screen.getByText('common.label.optional')).toBeInTheDocument()
  })

  it('names the explanation from its field label', async () => {
    const user = userEvent.setup()
    const tooltipText = 'Test Tooltip'
    render(<Label {...defaultProps} tooltip={tooltipText} />)

    await user.click(screen.getByRole('button', { name: 'Test Label' }))
    expect(await screen.findByRole('dialog', { name: 'Test Label' })).toHaveTextContent(tooltipText)
  })

  it('should hide optional text when required is true', () => {
    render(<Label {...defaultProps} isRequired showOptional />)
    expect(screen.queryByText('common.label.optional')).not.toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
  })
})
