import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorMessage from '../error-message'

vi.mock('@/app/components/base/icons/src/vender/solid/alertsAndFeedback', () => ({
  AlertTriangle: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="alert-icon" {...props} />,
}))

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
    render(<ErrorMessage title="Error" />)
    expect(screen.queryByText('Detailed error info')).not.toBeInTheDocument()
  })

  it('should render alert icon', () => {
    render(<ErrorMessage title="Error" />)
    expect(screen.getByTestId('alert-icon')).toBeInTheDocument()
  })
})
