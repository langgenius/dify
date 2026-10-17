import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Footer } from '../footer'

const defaultProps = {
  resultCount: null,
  isLoading: false,
  hasPartialFailure: false,
  onSelectMode: vi.fn(),
}

describe('Footer', () => {
  it('shows the result count and Enter hint after typing, without prefix buttons', () => {
    render(<Footer {...defaultProps} resultCount={3} />)

    expect(screen.getByText('app.gotoAnything.resultCount:{"count":3}')).toBeInTheDocument()
    expect(screen.getByText('Enter')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('reports partial provider failure even when results remain available', () => {
    render(<Footer {...defaultProps} resultCount={2} hasPartialFailure />)

    expect(screen.getByText('app.gotoAnything.someServicesUnavailable')).toBeInTheDocument()
    expect(screen.getByText('Enter')).toBeInTheDocument()
  })

  it('offers command and search prefixes for the empty input', async () => {
    const user = userEvent.setup()
    render(<Footer {...defaultProps} />)

    expect(
      screen.getByRole('button', { name: 'app.gotoAnything.groups.commands' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'app.gotoAnything.selectSearchType' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Enter')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'app.gotoAnything.groups.commands' }))
    expect(defaultProps.onSelectMode).toHaveBeenLastCalledWith('/')
    await user.click(screen.getByRole('button', { name: 'app.gotoAnything.selectSearchType' }))
    expect(defaultProps.onSelectMode).toHaveBeenLastCalledWith('@')
  })

  it('does not suggest Enter when nothing can be selected', () => {
    render(<Footer {...defaultProps} resultCount={0} />)

    expect(screen.getByText('app.gotoAnything.resultCount:{"count":0}')).toBeInTheDocument()
    expect(screen.queryByText('Enter')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('announces searching instead of zero results while the first results are loading', () => {
    render(<Footer {...defaultProps} resultCount={0} isLoading />)

    expect(screen.getByText('app.gotoAnything.searching')).toBeInTheDocument()
    expect(screen.queryByText('app.gotoAnything.resultCount:{"count":0}')).not.toBeInTheDocument()
    expect(screen.queryByText('Enter')).not.toBeInTheDocument()
  })
})
