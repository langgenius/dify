import { screen, waitFor } from '@testing-library/react'
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

  it.each(['loading', 'unavailable'] as const)(
    'exposes named disabled actions while %s',
    (state) => {
      const onRegenerate = vi.fn()
      render(
        <AccessPointUrl
          {...endpointProps}
          enabled
          {...{ [state]: true }}
          showOpen
          showQrCode
          showRegenerate
          copyLabel="Copy URL"
          qrCodeLabel="Show QR code"
          regenerateLabel="Regenerate URL"
          openLabel="Open"
          openUrl={endpointProps.value}
          onRegenerate={onRegenerate}
        />,
      )

      for (const name of ['Copy URL', 'Show QR code', 'Regenerate URL', 'Open'])
        expect(screen.getByRole('button', { name })).toBeDisabled()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(onRegenerate).not.toHaveBeenCalled()
    },
  )

  it('keeps copy and QR actions named when copying is disabled', () => {
    render(
      <AccessPointUrl
        {...endpointProps}
        enabled
        copyDisabled
        showQrCode
        copyLabel="Copy URL"
        qrCodeLabel="Show QR code"
      />,
    )
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show QR code' })).toBeDisabled()
  })

  it('makes the disabled open reason available from keyboard focus and dismisses it with Escape', async () => {
    const user = userEvent.setup()
    render(
      <AccessPointUrl
        {...endpointProps}
        enabled={false}
        copyDisabled
        showOpen
        openLabel="Open"
        openDisabledReason="Publish first"
      />,
    )
    const open = screen.getByRole('button', { name: 'Open' })
    expect(open).toHaveAccessibleDescription('Publish first')
    await user.tab()
    expect(open).toHaveFocus()
    expect(open).toHaveAttribute('aria-disabled', 'true')
    await screen.findByRole('tooltip')
    expect(open).toHaveAccessibleDescription('Publish first')
    await user.keyboard('{Enter}{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
    expect(open).toHaveFocus()
    expect(open).toHaveAccessibleDescription('Publish first')
  })
})
