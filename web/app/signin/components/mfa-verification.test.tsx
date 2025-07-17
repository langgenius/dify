import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useRouter } from 'next/navigation'

// Mock the service base to avoid ky import issues
jest.mock('@/service/base', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}))

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

// Mock translation
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock Toast
jest.mock('@/app/components/base/toast', () => ({
  __esModule: true,
  default: {
    notify: jest.fn(),
  },
}))

// Mock login service
jest.mock('@/service/common', () => ({
  login: jest.fn(),
}))

import MFAVerification from './mfa-verification'

describe('MFAVerification Component', () => {
  const mockRouter = {
    replace: jest.fn(),
  }

  const defaultProps = {
    email: 'test@example.com',
    password: 'password123',
    inviteToken: undefined,
    isInvite: false,
    locale: 'en-US',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue(mockRouter)
  })

  test('renders MFA verification form', () => {
    render(<MFAVerification {...defaultProps} />)

    expect(screen.getByText('mfa.mfaRequired')).toBeInTheDocument()
    expect(screen.getByText('mfa.mfaRequiredDescription')).toBeInTheDocument()
    expect(screen.getByLabelText('mfa.authenticatorCode')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('123456')).toBeInTheDocument()
  })

  test('handles TOTP code input correctly', () => {
    render(<MFAVerification {...defaultProps} />)

    const input = screen.getByPlaceholderText('123456')

    // Test numeric input
    fireEvent.change(input, { target: { value: '123456' } })
    expect(input).toHaveValue('123456')

    // Test non-numeric input is filtered
    fireEvent.change(input, { target: { value: 'abc123' } })
    expect(input).toHaveValue('123')
  })

  test('handles backup code input correctly', () => {
    render(<MFAVerification {...defaultProps} />)

    // Switch to backup code mode
    const switchButton = screen.getByText('mfa.useBackupCode')
    fireEvent.click(switchButton)

    const input = screen.getByPlaceholderText('A1B2C3D4')

    // Test alphanumeric input with automatic uppercase
    fireEvent.change(input, { target: { value: 'abcd1234' } })
    expect(input).toHaveValue('ABCD1234')

    // Test special characters are filtered
    fireEvent.change(input, { target: { value: 'ab-cd@12' } })
    expect(input).toHaveValue('ABCD12')
  })

  test('switches between TOTP and backup code modes', () => {
    render(<MFAVerification {...defaultProps} />)

    // Initially in TOTP mode
    expect(screen.getByLabelText('mfa.authenticatorCode')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('123456')).toBeInTheDocument()

    // Switch to backup code
    fireEvent.click(screen.getByText('mfa.useBackupCode'))
    expect(screen.getByLabelText('mfa.backupCode')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('A1B2C3D4')).toBeInTheDocument()

    // Switch back to TOTP
    fireEvent.click(screen.getByText('mfa.authenticatorCode'))
    expect(screen.getByLabelText('mfa.authenticatorCode')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('123456')).toBeInTheDocument()
  })

  test('disables verify button when code length is incorrect', () => {
    render(<MFAVerification {...defaultProps} />)

    const input = screen.getByPlaceholderText('123456')
    const verifyButton = screen.getByText('mfa.verify')

    // Initially button should be disabled (no code entered)
    expect(verifyButton.closest('button')).toBeDisabled()

    // Try with incomplete code
    fireEvent.change(input, { target: { value: '123' } })
    expect(verifyButton.closest('button')).toBeDisabled()

    // Try with complete code
    fireEvent.change(input, { target: { value: '123456' } })
    expect(verifyButton.closest('button')).not.toBeDisabled()

    // For backup code mode
    const switchButton = screen.getByText('mfa.useBackupCode')
    fireEvent.click(switchButton)

    const backupInput = screen.getByPlaceholderText('A1B2C3D4')

    // Button should be disabled with incomplete backup code
    fireEvent.change(backupInput, { target: { value: 'ABCD' } })
    expect(verifyButton.closest('button')).toBeDisabled()

    // Button should be enabled with complete backup code
    fireEvent.change(backupInput, { target: { value: 'ABCD1234' } })
    expect(verifyButton.closest('button')).not.toBeDisabled()
  })

  test('successful MFA verification with TOTP', async () => {
    const { login } = require('@/service/common')
    login.mockResolvedValue({
      result: 'success',
      data: {
        access_token: 'test_token',
        refresh_token: 'refresh_token',
      },
    })

    render(<MFAVerification {...defaultProps} />)

    const input = screen.getByPlaceholderText('123456')
    fireEvent.change(input, { target: { value: '123456' } })

    const verifyButton = screen.getByText('mfa.verify')
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        url: '/login',
        body: {
          email: 'test@example.com',
          password: 'password123',
          mfa_code: '123456',
          is_backup_code: false,
          language: 'en-US',
          remember_me: true,
        },
      })
    })

    await waitFor(() => {
      expect(localStorage.getItem('console_token')).toBe('test_token')
      expect(localStorage.getItem('refresh_token')).toBe('refresh_token')
      expect(mockRouter.replace).toHaveBeenCalledWith('/apps')
    })
  })

  test('successful MFA verification with backup code', async () => {
    const { login } = require('@/service/common')
    login.mockResolvedValue({
      result: 'success',
      data: {
        access_token: 'test_token',
        refresh_token: 'refresh_token',
      },
    })

    render(<MFAVerification {...defaultProps} />)

    // Switch to backup code
    fireEvent.click(screen.getByText('mfa.useBackupCode'))

    const input = screen.getByPlaceholderText('A1B2C3D4')
    fireEvent.change(input, { target: { value: 'ABCD1234' } })

    const verifyButton = screen.getByText('mfa.verify')
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        url: '/login',
        body: {
          email: 'test@example.com',
          password: 'password123',
          mfa_code: 'ABCD1234',
          is_backup_code: true,
          language: 'en-US',
          remember_me: true,
        },
      })
    })
  })

  test('handles invalid MFA token error', async () => {
    const { login } = require('@/service/common')
    const Toast = require('@/app/components/base/toast').default

    login.mockResolvedValue({
      result: 'fail',
      code: 'mfa_token_invalid',
    })

    render(<MFAVerification {...defaultProps} />)

    const input = screen.getByPlaceholderText('123456')
    fireEvent.change(input, { target: { value: '000000' } })

    const verifyButton = screen.getByText('mfa.verify')
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'mfa.invalidToken',
      })
    })
  })

  test('handles network error', async () => {
    const { login } = require('@/service/common')
    const Toast = require('@/app/components/base/toast').default

    login.mockRejectedValue(new Error('Network error'))

    render(<MFAVerification {...defaultProps} />)

    const input = screen.getByPlaceholderText('123456')
    fireEvent.change(input, { target: { value: '123456' } })

    const verifyButton = screen.getByText('mfa.verify')
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Network error',
      })
    })
  })

  test('handles invite flow correctly', async () => {
    const { login } = require('@/service/common')
    login.mockResolvedValue({
      result: 'success',
      data: {
        access_token: 'test_token',
        refresh_token: 'refresh_token',
      },
    })

    const inviteProps = {
      ...defaultProps,
      isInvite: true,
      inviteToken: 'invite_token_123',
    }

    render(<MFAVerification {...inviteProps} />)

    const input = screen.getByPlaceholderText('123456')
    fireEvent.change(input, { target: { value: '123456' } })

    const verifyButton = screen.getByText('mfa.verify')
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        url: '/login',
        body: {
          email: 'test@example.com',
          password: 'password123',
          mfa_code: '123456',
          is_backup_code: false,
          language: 'en-US',
          remember_me: true,
          invite_token: 'invite_token_123',
        },
      })
    })

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/signin/invite-settings?invite_token=invite_token_123')
    })
  })

  test('handles Enter key press for submission', () => {
    const { login } = require('@/service/common')
    login.mockResolvedValue({
      result: 'success',
      data: {
        access_token: 'test_token',
        refresh_token: 'refresh_token',
      },
    })

    render(<MFAVerification {...defaultProps} />)

    const input = screen.getByPlaceholderText('123456')
    fireEvent.change(input, { target: { value: '123456' } })

    // Press Enter
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(login).toHaveBeenCalled()
  })

  test('disables verify button when loading', async () => {
    const { login } = require('@/service/common')
    login.mockImplementation(() => new Promise(() => {
      // Never resolves - intentionally empty for testing loading state
    })) // Never resolves

    render(<MFAVerification {...defaultProps} />)

    const input = screen.getByPlaceholderText('123456')
    fireEvent.change(input, { target: { value: '123456' } })

    const verifyButton = screen.getByText('mfa.verify')
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(verifyButton.closest('button')).toBeDisabled()
    })
  })
})
