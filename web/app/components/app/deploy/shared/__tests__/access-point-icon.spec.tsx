import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AccessPointIcon } from '../access-point-icon'

describe('AccessPointIcon', () => {
  it('links active access points when navigation is allowed', () => {
    render(
      <AccessPointIcon
        accessPoint="webApp"
        active
        href="/app/app-1/access-point?environment=built-in&accessPoint=webApp"
      />,
    )

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/app/app-1/access-point?environment=built-in&accessPoint=webApp',
    )
  })

  it('keeps active access points visually active when navigation is not allowed', () => {
    render(<AccessPointIcon accessPoint="webApp" active />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).not.toHaveClass('opacity-30')
  })

  it('dims inactive access points', () => {
    render(<AccessPointIcon accessPoint="webApp" active={false} />)

    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).toHaveClass('opacity-30')
  })
})
