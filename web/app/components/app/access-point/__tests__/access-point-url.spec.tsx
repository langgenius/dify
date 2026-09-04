import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessPointUrl } from '@/app/components/base/access-point/url'
import { render } from '@/test/console/render'

const endpointProps = {
  label: 'Access URL',
  unavailableLabel: 'FAILED',
  value: 'https://example.test/access',
}

describe('AccessPointUrl', () => {
  it('keeps a disabled endpoint visible without marking it unavailable', () => {
    render(<AccessPointUrl {...endpointProps} enabled={false} showOpen openLabel="Open" />)

    expect(screen.getByText(endpointProps.value)).toBeInTheDocument()
    expect(screen.queryByText(endpointProps.unavailableLabel)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
  })

  it('exposes an available endpoint as an external link', () => {
    render(
      <AccessPointUrl
        {...endpointProps}
        enabled
        showOpen
        openLabel="Open"
        openUrl={endpointProps.value}
      />,
    )

    const openLink = screen.getByRole('link', { name: 'Open' })
    expect(openLink).toHaveAttribute('href', endpointProps.value)
    expect(openLink).toHaveAttribute('target', '_blank')
    expect(openLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('explains why the open action is disabled', async () => {
    const user = userEvent.setup()
    render(
      <AccessPointUrl
        {...endpointProps}
        enabled={false}
        showOpen
        openLabel="Open"
        openDisabledReason="Publish first"
      />,
    )

    await user.hover(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Publish first')
  })

  it('shows an unavailable endpoint without replacing it with a loading skeleton', () => {
    render(<AccessPointUrl {...endpointProps} enabled={false} unavailable />)

    expect(screen.getByText(endpointProps.unavailableLabel)).toBeInTheDocument()
    expect(screen.getByText(endpointProps.value)).toBeInTheDocument()
  })

  it('shows loading independently from the unavailable state', () => {
    render(<AccessPointUrl {...endpointProps} enabled={false} loading />)

    expect(screen.queryByText(endpointProps.unavailableLabel)).not.toBeInTheDocument()
    expect(screen.queryByText(endpointProps.value)).not.toBeInTheDocument()
  })
})
