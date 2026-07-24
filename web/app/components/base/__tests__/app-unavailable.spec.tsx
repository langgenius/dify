import { render, screen } from '@testing-library/react'
import AppUnavailable from '../app-unavailable'

describe('AppUnavailable', () => {
  it('shows the error code and default unavailable message', () => {
    render(<AppUnavailable code={403} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('403')
    expect(screen.getByText('share.common.appUnavailable')).toBeInTheDocument()
  })

  it('shows the unknown error message when requested', () => {
    render(<AppUnavailable isUnknownReason />)

    expect(screen.getByText('share.common.appUnknownError')).toBeInTheDocument()
  })

  it('prioritizes a supplied reason over the generic message', () => {
    render(<AppUnavailable isUnknownReason unknownReason="Workspace was removed" />)

    expect(screen.getByText('Workspace was removed')).toBeInTheDocument()
    expect(screen.queryByText('share.common.appUnknownError')).not.toBeInTheDocument()
  })
})
