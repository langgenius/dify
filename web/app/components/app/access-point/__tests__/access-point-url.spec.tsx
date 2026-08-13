import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import { AccessPointUrl } from '../shared/access-point-url'

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
