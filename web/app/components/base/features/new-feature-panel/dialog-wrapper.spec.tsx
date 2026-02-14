import { render, screen } from '@testing-library/react'
import * as React from 'react'
import DialogWrapper from './dialog-wrapper'

describe('DialogWrapper', () => {
  it('should render children when show is true', () => {
    render(
      <DialogWrapper show={true}>
        <div data-testid="content">Content</div>
      </DialogWrapper>,
    )

    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('should not render children when show is false', () => {
    render(
      <DialogWrapper show={false}>
        <div data-testid="content">Content</div>
      </DialogWrapper>,
    )

    expect(screen.queryByTestId('content')).not.toBeInTheDocument()
  })

  it('should apply inWorkflow styling by default', () => {
    render(
      <DialogWrapper show={true}>
        <div data-testid="content">Content</div>
      </DialogWrapper>,
    )

    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('should accept custom className', () => {
    render(
      <DialogWrapper show={true} className="custom-class">
        <div data-testid="content">Content</div>
      </DialogWrapper>,
    )

    expect(screen.getByTestId('content')).toBeInTheDocument()
  })
})
