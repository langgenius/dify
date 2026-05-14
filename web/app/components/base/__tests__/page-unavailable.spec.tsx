import { render, screen } from '@testing-library/react'
import PageUnavailable from '../page-unavailable'

describe('PageUnavailable', () => {
  it('renders the page unavailable message', () => {
    render(<PageUnavailable />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('404')
    expect(screen.getByText('common.pageUnavailable')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<PageUnavailable className="h-full w-full" />)

    expect(container.firstElementChild).toHaveClass('h-full', 'w-full')
  })
})
