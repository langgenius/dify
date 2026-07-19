import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AuthenticationSection from '../authentication-section'

const defaultProps = {
  onDynamicRegistrationChange: vi.fn(),
  clientID: 'client-123',
  onClientIDChange: vi.fn(),
  credentials: 'secret-456',
  onCredentialsChange: vi.fn(),
}

describe('AuthenticationSection', () => {
  it('disables manual credentials while dynamic registration is enabled', () => {
    render(<AuthenticationSection {...defaultProps} isDynamicRegistration />)

    expect(
      screen.getByRole('switch', { name: 'tools.mcp.modal.useDynamicClientRegistration' }),
    ).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.clientID' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.clientSecret' })).toBeDisabled()
    expect(screen.queryByText('tools.mcp.modal.redirectUrlWarning')).not.toBeInTheDocument()
  })

  it('exposes manual credentials and the callback URL when dynamic registration is disabled', () => {
    render(<AuthenticationSection {...defaultProps} isDynamicRegistration={false} />)

    expect(
      screen.getByRole('switch', { name: 'tools.mcp.modal.useDynamicClientRegistration' }),
    ).not.toBeChecked()
    expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.clientID' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.clientSecret' })).toBeEnabled()
    expect(screen.getByText('tools.mcp.modal.redirectUrlWarning')).toBeInTheDocument()
    expect(screen.getByText(/\/mcp\/oauth\/callback/)).toBeInTheDocument()
  })
})
