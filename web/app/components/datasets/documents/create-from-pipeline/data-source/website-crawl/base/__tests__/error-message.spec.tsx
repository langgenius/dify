import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ErrorMessage from '../error-message'

describe('ErrorMessage', () => {
  it('should render title', () => {
    render(<ErrorMessage title="Something went wrong" />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('should render error message when provided', () => {
    render(<ErrorMessage title="Error" errorMsg="Detailed error info" />)
    expect(screen.getByText('Detailed error info')).toBeInTheDocument()
  })

  it('should not render error message when not provided', () => {
    const { container } = render(<ErrorMessage title="Error" />)
    const textElements = container.querySelectorAll('.system-xs-regular')
    expect(textElements).toHaveLength(0)
  })

  it('should apply custom className', () => {
    const { container } = render(<ErrorMessage title="Error" className="custom-cls" />)
    expect(container.querySelector('.custom-cls')).toBeInTheDocument()
  })
})
