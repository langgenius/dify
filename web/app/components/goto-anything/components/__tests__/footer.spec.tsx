import { render, screen } from '@testing-library/react'
import { Footer } from '../footer'

const defaultProps = {
  resultCount: null,
  canActivate: false,
  hasPartialFailure: false,
}

describe('Footer', () => {
  it('shows the result count and activation hint without search-mode actions', () => {
    render(<Footer {...defaultProps} resultCount={3} canActivate />)

    expect(screen.getByText('app.gotoAnything.resultCount:{"count":3}')).toBeInTheDocument()
    expect(screen.getByText('app.gotoAnything.activate')).toBeInTheDocument()
    expect(screen.getByText('Enter')).toBeInTheDocument()
  })

  it('reports partial provider failure even when results remain available', () => {
    render(<Footer {...defaultProps} resultCount={2} canActivate hasPartialFailure />)

    expect(screen.getByText('app.gotoAnything.someServicesUnavailable')).toBeInTheDocument()
    expect(screen.getByText('app.gotoAnything.activate')).toBeInTheDocument()
    expect(screen.getByText('Enter')).toBeInTheDocument()
  })

  it('shows only the close shortcut when there are no actionable results', () => {
    render(<Footer {...defaultProps} />)

    expect(screen.getByText('app.gotoAnything.pressEscToClose')).toBeInTheDocument()
  })
})
