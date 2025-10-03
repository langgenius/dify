import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock the service base to avoid ky import issues
jest.mock('@/service/base', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}))

// Mock the translation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

import MFAPage from './mfa-page'

// Mock the Toast component
jest.mock('@/app/components/base/toast', () => ({
  __esModule: true,
  default: {
    notify: jest.fn(),
  },
}))

// Mock Modal component
jest.mock('@/app/components/base/modal', () => ({
  __esModule: true,
  default: ({ isShow, onClose, children }: any) =>
    isShow ? <div data-testid="modal">{children}</div> : null,
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Create a test wrapper component
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('MFAPage Component', () => {
  let wrapper: ReturnType<typeof createWrapper>

  beforeEach(() => {
    jest.clearAllMocks()
    wrapper = createWrapper()
  })

  test('renders loading state initially', () => {
    const { get } = require('@/service/base')
    get.mockImplementation(() => new Promise(() => {
      // Never resolves - intentionally empty for testing loading state
    })) // Never resolves

    const { container } = render(<MFAPage />, { wrapper })

    // Look for the loading spinner icon
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  test('renders enable button when MFA is disabled', async () => {
    const { get } = require('@/service/base')
    get.mockResolvedValue({ enabled: false })

    render(<MFAPage />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText('mfa.enable')).toBeInTheDocument()
    })
  })

  test('renders disable button when MFA is enabled', async () => {
    const { get } = require('@/service/base')
    get.mockResolvedValue({
      enabled: true,
      setup_at: '2025-01-01T12:00:00',
    })

    render(<MFAPage />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText('mfa.disable')).toBeInTheDocument()
    })
  })

  test('opens setup modal when enable button is clicked', async () => {
    const { get, post } = require('@/service/base')
    get.mockResolvedValue({ enabled: false })
    post.mockResolvedValue({
      secret: 'TEST_SECRET',
      qr_code: 'data:image/png;base64,test',
    })

    render(<MFAPage />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText('mfa.enable')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByText('mfa.enable'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    }, { timeout: 10000 })

    expect(screen.getByText('mfa.scanQRCode')).toBeInTheDocument()
  }, 15000)

  test('completes MFA setup successfully', async () => {
    const { get, post } = require('@/service/base')
    const Toast = require('@/app/components/base/toast').default

    get.mockResolvedValue({ enabled: false })
    post.mockImplementation((url) => {
      if (url.includes('/setup') && !url.includes('/complete')) {
        return Promise.resolve({
          secret: 'TEST_SECRET',
          qr_code: 'data:image/png;base64,test',
        })
      }
      else if (url.includes('/setup/complete')) {
        return Promise.resolve({
          message: 'MFA setup successfully',
          backup_codes: ['CODE1', 'CODE2', 'CODE3', 'CODE4', 'CODE5', 'CODE6', 'CODE7', 'CODE8'],
          setup_at: '2025-01-01T12:00:00',
        })
      }
    })

    render(<MFAPage />, { wrapper })

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByText('mfa.enable')).toBeInTheDocument()
    })

    // Click enable
    fireEvent.click(screen.getByText('mfa.enable'))

    // Wait for QR code to be displayed
    await waitFor(() => {
      const qrCode = screen.queryByAltText('MFA QR Code')
      expect(qrCode).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click next button to go to verify step
    fireEvent.click(screen.getByText('mfa.next'))

    // Wait for input field to appear
    await waitFor(() => {
      expect(screen.getByPlaceholderText('000000')).toBeInTheDocument()
    })

    // Enter TOTP code
    const input = screen.getByPlaceholderText('000000')
    fireEvent.change(input, { target: { value: '123456' } })

    // Click verify button
    const verifyButton = screen.getByRole('button', { name: /verify|mfa.verify/i })
    fireEvent.click(verifyButton)

    // Wait for backup codes to be displayed
    await waitFor(() => {
      expect(screen.getByText('mfa.backupCodesTitle')).toBeInTheDocument()
    })

    // Click done button
    fireEvent.click(screen.getByText('mfa.done'))

    // Check that toast was called
    expect(Toast.notify).toHaveBeenCalledWith({
      type: 'success',
      message: 'mfa.setupSuccess',
    })
  }, 15000)

  test('shows error when setup fails', async () => {
    const { get, post } = require('@/service/base')
    const Toast = require('@/app/components/base/toast').default

    get.mockResolvedValue({ enabled: false })
    post.mockImplementation((url) => {
      if (url.includes('/setup') && !url.includes('/complete')) {
        return Promise.resolve({
          secret: 'TEST_SECRET',
          qr_code: 'data:image/png;base64,test',
        })
      }
      else if (url.includes('/setup/complete')) {
        return Promise.reject(new Error('Invalid TOTP token'))
      }
    })

    render(<MFAPage />, { wrapper })

    // Wait and click enable
    await waitFor(() => {
      expect(screen.getByText('mfa.enable')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('mfa.enable'))

    // Wait for QR code
    await waitFor(() => {
      expect(screen.queryByAltText('MFA QR Code')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click next to go to verify step
    fireEvent.click(screen.getByText('mfa.next'))

    // Wait for input
    await waitFor(() => {
      expect(screen.getByPlaceholderText('000000')).toBeInTheDocument()
    })

    // Enter wrong TOTP code
    const input = screen.getByPlaceholderText('000000')
    fireEvent.change(input, { target: { value: '000000' } })

    // Click verify
    const verifyButton = screen.getByRole('button', { name: /verify|mfa.verify/i })
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'mfa.invalidToken',
      })
    }, { timeout: 5000 })
  }, 15000)

  test('disables MFA successfully', async () => {
    const { get, post } = require('@/service/base')
    const Toast = require('@/app/components/base/toast').default

    get.mockResolvedValue({
      enabled: true,
      setup_at: '2025-01-01T12:00:00',
    })
    post.mockImplementation((url) => {
      if (url.includes('/disable')) {
        return Promise.resolve({
          success: true,
          message: 'MFA disabled successfully',
        })
      }
    })

    render(<MFAPage />, { wrapper })

    // Wait for disable button
    await waitFor(() => {
      expect(screen.getByText('mfa.disable')).toBeInTheDocument()
    })

    // Click disable
    fireEvent.click(screen.getByText('mfa.disable'))

    // Modal should open
    await waitFor(() => {
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    // Find password input
    const passwordInput = screen.getByPlaceholderText('common.account.password')
    fireEvent.change(passwordInput, { target: { value: 'password123' } })

    // Click disable button in modal
    const disableButtons = screen.getAllByText('mfa.disable')
    // The second one should be the button in the modal
    fireEvent.click(disableButtons[1])

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'success',
        message: 'mfa.disabledSuccessfully',
      })
    }, { timeout: 5000 })
  }, 15000)

  test('shows error when disable fails with wrong password', async () => {
    const { get, post } = require('@/service/base')
    const Toast = require('@/app/components/base/toast').default

    get.mockResolvedValue({
      enabled: true,
      setup_at: '2025-01-01T12:00:00',
    })
    post.mockImplementation((url) => {
      if (url.includes('/disable'))
        return Promise.reject(new Error('Invalid password'))
    })

    render(<MFAPage />, { wrapper })

    // Wait and click disable
    await waitFor(() => {
      expect(screen.getByText('mfa.disable')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('mfa.disable'))

    // Wait for modal
    await waitFor(() => {
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    // Enter wrong password
    const passwordInput = screen.getByPlaceholderText('common.account.password')
    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } })

    // Click disable button in modal
    const disableButtons = screen.getAllByText('mfa.disable')
    // The second one should be the button in the modal
    fireEvent.click(disableButtons[1])

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'mfa.invalidPassword',
      })
    }, { timeout: 5000 })
  }, 15000)

  test('handles backup codes display correctly', async () => {
    const { get, post } = require('@/service/base')

    get.mockResolvedValue({ enabled: false })

    // Mock immediate responses
    post.mockImplementation((url) => {
      if (url.includes('/setup') && !url.includes('/complete')) {
        return Promise.resolve({
          secret: 'TEST_SECRET',
          qr_code: 'data:image/png;base64,test',
        })
      }
      else if (url.includes('/setup/complete')) {
        return Promise.resolve({
          message: 'MFA setup successfully',
          backup_codes: ['ABCD1234', 'EFGH5678', 'IJKL9012', 'MNOP3456', 'QRST7890', 'UVWX1234', 'YZAB5678', 'CDEF9012'],
          setup_at: '2025-01-01T12:00:00',
        })
      }
    })

    render(<MFAPage />, { wrapper })

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByText('mfa.enable')).toBeInTheDocument()
    })

    // Setup MFA
    fireEvent.click(screen.getByText('mfa.enable'))

    // Wait for QR code
    await waitFor(() => {
      const qrCode = screen.queryByAltText('MFA QR Code')
      expect(qrCode).toBeInTheDocument()
    }, { timeout: 10000 })

    // Click next to go to verify step
    fireEvent.click(screen.getByText('mfa.next'))

    // Wait for input
    await waitFor(() => {
      expect(screen.getByPlaceholderText('000000')).toBeInTheDocument()
    })

    // Enter TOTP code
    const input = screen.getByPlaceholderText('000000')
    fireEvent.change(input, { target: { value: '123456' } })

    // Verify
    const verifyButton = screen.getByRole('button', { name: /verify|mfa.verify/i })
    fireEvent.click(verifyButton)

    // Check backup codes are displayed
    await waitFor(() => {
      expect(screen.getByText('mfa.backupCodesTitle')).toBeInTheDocument()
      expect(screen.getByText('ABCD1234')).toBeInTheDocument()
      expect(screen.getByText('EFGH5678')).toBeInTheDocument()
    }, { timeout: 5000 })
  }, 10000) // Increase test timeout
})
