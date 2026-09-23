import { fireEvent, render, screen } from '@testing-library/react'
import { CredentialIcon } from '../credential-icon'

describe('CredentialIcon', () => {
  it('shows the credential initial when there is no avatar', () => {
    render(<CredentialIcon name="alice" />)

    expect(screen.getByText('A').parentElement).toHaveAttribute('aria-hidden', 'true')
  })

  it('hides the credential avatar from the accessibility tree', () => {
    const { container } = render(
      <CredentialIcon avatarUrl="https://example.com/avatar.png" name="Alice" />,
    )

    const image = container.querySelector('img')

    expect(image).toHaveAttribute('src', 'https://example.com/avatar.png')
    expect(image).toHaveAttribute('alt', '')
    expect(image?.parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('falls back to the credential initial when the avatar fails to load', () => {
    const { container } = render(
      <CredentialIcon avatarUrl="https://example.com/missing.png" name="Alice" />,
    )

    fireEvent.error(container.querySelector('img')!)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('A').parentElement).toHaveAttribute('aria-hidden', 'true')
  })
})
