import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AuthenticationSection from './authentication-section'

describe('AuthenticationSection', () => {
  const defaultProps = {
    isDynamicRegistration: true,
    onDynamicRegistrationChange: vi.fn(),
    clientID: '',
    onClientIDChange: vi.fn(),
    credentials: '',
    onCredentialsChange: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<AuthenticationSection {...defaultProps} />)
      expect(screen.getByText('tools.mcp.modal.useDynamicClientRegistration')).toBeInTheDocument()
    })

    it('should render switch for dynamic registration', () => {
      render(<AuthenticationSection {...defaultProps} />)
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should render client ID input', () => {
      render(<AuthenticationSection {...defaultProps} clientID="test-client-id" />)
      expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
    })

    it('should render credentials input', () => {
      render(<AuthenticationSection {...defaultProps} credentials="test-secret" />)
      expect(screen.getByDisplayValue('test-secret')).toBeInTheDocument()
    })

    it('should render labels for all fields', () => {
      render(<AuthenticationSection {...defaultProps} />)
      expect(screen.getByText('tools.mcp.modal.useDynamicClientRegistration')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.modal.clientID')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.modal.clientSecret')).toBeInTheDocument()
    })
  })

  describe('Dynamic Registration Toggle', () => {
    it('should not show warning when isDynamicRegistration is true', () => {
      render(<AuthenticationSection {...defaultProps} isDynamicRegistration={true} />)
      expect(screen.queryByText('tools.mcp.modal.redirectUrlWarning')).not.toBeInTheDocument()
    })

    it('should show warning when isDynamicRegistration is false', () => {
      render(<AuthenticationSection {...defaultProps} isDynamicRegistration={false} />)
      expect(screen.getByText('tools.mcp.modal.redirectUrlWarning')).toBeInTheDocument()
    })

    it('should show OAuth callback URL in warning', () => {
      render(<AuthenticationSection {...defaultProps} isDynamicRegistration={false} />)
      expect(screen.getByText(/\/mcp\/oauth\/callback/)).toBeInTheDocument()
    })

    it('should disable inputs when isDynamicRegistration is true', () => {
      render(<AuthenticationSection {...defaultProps} isDynamicRegistration={true} />)
      const inputs = screen.getAllByRole('textbox')
      inputs.forEach((input) => {
        expect(input).toBeDisabled()
      })
    })

    it('should enable inputs when isDynamicRegistration is false', () => {
      render(<AuthenticationSection {...defaultProps} isDynamicRegistration={false} />)
      const inputs = screen.getAllByRole('textbox')
      inputs.forEach((input) => {
        expect(input).not.toBeDisabled()
      })
    })
  })

  describe('User Interactions', () => {
    it('should call onDynamicRegistrationChange when switch is toggled', () => {
      const onDynamicRegistrationChange = vi.fn()
      render(
        <AuthenticationSection
          {...defaultProps}
          onDynamicRegistrationChange={onDynamicRegistrationChange}
        />,
      )

      const switchElement = screen.getByRole('switch')
      fireEvent.click(switchElement)

      expect(onDynamicRegistrationChange).toHaveBeenCalled()
    })

    it('should call onClientIDChange when client ID input changes', () => {
      const onClientIDChange = vi.fn()
      render(
        <AuthenticationSection
          {...defaultProps}
          isDynamicRegistration={false}
          onClientIDChange={onClientIDChange}
        />,
      )

      const inputs = screen.getAllByRole('textbox')
      const clientIDInput = inputs[0]
      fireEvent.change(clientIDInput, { target: { value: 'new-client-id' } })

      expect(onClientIDChange).toHaveBeenCalledWith('new-client-id')
    })

    it('should call onCredentialsChange when credentials input changes', () => {
      const onCredentialsChange = vi.fn()
      render(
        <AuthenticationSection
          {...defaultProps}
          isDynamicRegistration={false}
          onCredentialsChange={onCredentialsChange}
        />,
      )

      const inputs = screen.getAllByRole('textbox')
      const credentialsInput = inputs[1]
      fireEvent.change(credentialsInput, { target: { value: 'new-secret' } })

      expect(onCredentialsChange).toHaveBeenCalledWith('new-secret')
    })
  })

  describe('Props', () => {
    it('should display provided clientID value', () => {
      render(<AuthenticationSection {...defaultProps} clientID="my-client-123" />)
      expect(screen.getByDisplayValue('my-client-123')).toBeInTheDocument()
    })

    it('should display provided credentials value', () => {
      render(<AuthenticationSection {...defaultProps} credentials="secret-456" />)
      expect(screen.getByDisplayValue('secret-456')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string values', () => {
      render(<AuthenticationSection {...defaultProps} clientID="" credentials="" />)
      const inputs = screen.getAllByRole('textbox')
      expect(inputs).toHaveLength(2)
      inputs.forEach((input) => {
        expect(input).toHaveValue('')
      })
    })

    it('should handle special characters in values', () => {
      render(
        <AuthenticationSection
          {...defaultProps}
          clientID="client@123!#$"
          credentials="secret&*()_+"
        />,
      )
      expect(screen.getByDisplayValue('client@123!#$')).toBeInTheDocument()
      expect(screen.getByDisplayValue('secret&*()_+')).toBeInTheDocument()
    })
  })
})
