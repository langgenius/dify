import { fireEvent, render, screen } from '@testing-library/react'
import { CredentialIcon } from '../credential-icon'

describe('CredentialIcon', () => {
  it('shows the credential initial when there is no avatar', () => {
    render(<CredentialIcon name="alice" />)

    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('shows the credential avatar when one is configured', () => {
    render(<CredentialIcon avatarUrl="https://example.com/avatar.png" name="Alice" />)

    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/avatar.png')
  })

  it('falls back to the credential initial when the avatar fails to load', () => {
    render(<CredentialIcon avatarUrl="https://example.com/missing.png" name="Alice" />)

    fireEvent.error(screen.getByRole('img'))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})
