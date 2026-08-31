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

  it('renders active access points as disabled controls when navigation is not allowed', () => {
    render(<AccessPointIcon accessPoint="webApp" active />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
