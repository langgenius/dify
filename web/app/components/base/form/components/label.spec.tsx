import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Label from './label'

describe('Label', () => {
  const defaultProps = {
    htmlFor: 'test-input',
    label: 'Test Label',
  }

  it('should render the label text', () => {
    render(<Label {...defaultProps} />)
    expect(screen.getByText('Test Label')).toBeInTheDocument()
  })

  it('should focus related input when users click the label', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Label {...defaultProps} />
        <input id="test-input" />
      </>,
    )

    await user.click(screen.getByText('Test Label'))
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('should show optional text when the field is not required', () => {
    render(<Label {...defaultProps} showOptional />)
    expect(screen.getByText('common.label.optional')).toBeInTheDocument()
  })

  it('should show required marker when the field is required', () => {
    render(<Label {...defaultProps} isRequired />)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('should show tooltip content on hover', async () => {
    const user = userEvent.setup()
    const tooltipText = 'Test Tooltip'
    render(<Label {...defaultProps} tooltip={tooltipText} />)

    await user.hover(screen.getByTestId('test-input-tooltip'))
    expect(screen.getByText(tooltipText)).toBeInTheDocument()
  })

  it('should hide optional text when required is true', () => {
    render(<Label {...defaultProps} isRequired showOptional />)
    expect(screen.queryByText('common.label.optional')).not.toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
  })
})
