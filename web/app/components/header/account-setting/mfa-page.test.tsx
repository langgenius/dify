import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  default: ({ isOpen, onClose, children }: any) => 
    isOpen ? <div data-testid="modal">{children}</div> : null,
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Create a test wrapper component
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
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
    get.mockImplementation(() => new Promise(() => {})) // Never resolves

    render(<MFAPage />, { wrapper })
    
    expect(screen.getByText('Loading...')).toBeInTheDocument()
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
      setup_at: '2025-01-01T12:00:00'
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
      qr_code: 'data:image/png;base64,test'
    })

    render(<MFAPage />, { wrapper })
    
    await waitFor(() => {
      expect(screen.getByText('mfa.enable')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('mfa.enable'))

    await waitFor(() => {
      expect(screen.getByTestId('modal')).toBeInTheDocument()
      expect(screen.getByText('mfa.setupTitle')).toBeInTheDocument()
    })
  })

  test('completes MFA setup successfully', async () => {
    const { get, post } = require('@/service/base')
    const Toast = require('@/app/components/base/toast').default
    
    get.mockResolvedValue({ enabled: false })
    post.mockImplementation((url) => {
      if (url.includes('/setup') && !url.includes('/complete')) {
        return Promise.resolve({
          secret: 'TEST_SECRET',
          qr_code: 'data:image/png;base64,test'
        })
      } else if (url.includes('/setup/complete')) {
        return Promise.resolve({
          message: 'MFA setup successfully',
          backup_codes: ['CODE1', 'CODE2', 'CODE3', 'CODE4', 'CODE5', 'CODE6', 'CODE7', 'CODE8'],
          setup_at: '2025-01-01T12:00:00'
        })
      }
    })

    render(<MFAPage />, { wrapper })
    
    // Click enable
    await waitFor(() => {
      fireEvent.click(screen.getByText('mfa.enable'))
    })

    // Wait for QR code to be displayed
    await waitFor(() => {
      expect(screen.getByAltText('MFA QR Code')).toBeInTheDocument()
    })

    // Enter TOTP code
    const inputs = screen.getAllByRole('textbox')
    // Simulate entering '123456'
    '123456'.split('').forEach((digit, index) => {
      fireEvent.change(inputs[index], { target: { value: digit } })
    })

    // Click verify button
    const verifyButton = screen.getByRole('button', { name: /verify|mfa.verify/i })
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'success',
        message: 'mfa.setupSuccess'
      })
    })
  })

  test('shows error when setup fails', async () => {
    const { get, post } = require('@/service/base')
    const Toast = require('@/app/components/base/toast').default
    
    get.mockResolvedValue({ enabled: false })
    post.mockImplementation((url) => {
      if (url.includes('/setup') && !url.includes('/complete')) {
        return Promise.resolve({
          secret: 'TEST_SECRET',
          qr_code: 'data:image/png;base64,test'
        })
      } else if (url.includes('/setup/complete')) {
        return Promise.reject(new Error('Invalid TOTP token'))
      }
    })

    render(<MFAPage />, { wrapper })
    
    // Click enable
    await waitFor(() => {
      fireEvent.click(screen.getByText('mfa.enable'))
    })

    // Wait for QR code
    await waitFor(() => {
      expect(screen.getByAltText('MFA QR Code')).toBeInTheDocument()
    })

    // Enter wrong TOTP code
    const inputs = screen.getAllByRole('textbox')
    '000000'.split('').forEach((digit, index) => {
      fireEvent.change(inputs[index], { target: { value: digit } })
    })

    // Click verify
    const verifyButton = screen.getByRole('button', { name: /verify|mfa.verify/i })
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Invalid TOTP token'
      })
    })
  })

  test('disables MFA successfully', async () => {
    const { get, post } = require('@/service/base')
    const Toast = require('@/app/components/base/toast').default
    
    get.mockResolvedValue({ 
      enabled: true,
      setup_at: '2025-01-01T12:00:00'
    })
    post.mockImplementation((url) => {
      if (url.includes('/disable')) {
        return Promise.resolve({ 
          success: true,
          message: 'MFA disabled successfully' 
        })
      }
    })

    render(<MFAPage />, { wrapper })
    
    // Click disable
    await waitFor(() => {
      fireEvent.click(screen.getByText('mfa.disable'))
    })

    // Modal should open
    await waitFor(() => {
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    // Enter password
    const passwordInput = screen.getByPlaceholderText('mfa.enterYourPassword')
    fireEvent.change(passwordInput, { target: { value: 'password123' } })

    // Click confirm
    const confirmButton = screen.getByText('common.operation.confirm')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'success',
        message: 'mfa.disabledSuccessfully'
      })
    })
  })

  test('shows error when disable fails with wrong password', async () => {
    const { get, post } = require('@/service/base')
    const Toast = require('@/app/components/base/toast').default
    
    get.mockResolvedValue({ 
      enabled: true,
      setup_at: '2025-01-01T12:00:00'
    })
    post.mockImplementation((url) => {
      if (url.includes('/disable')) {
        return Promise.reject(new Error('Invalid password'))
      }
    })

    render(<MFAPage />, { wrapper })
    
    // Click disable
    await waitFor(() => {
      fireEvent.click(screen.getByText('mfa.disable'))
    })

    // Enter wrong password
    const passwordInput = screen.getByPlaceholderText('mfa.enterYourPassword')
    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } })

    // Click confirm
    const confirmButton = screen.getByText('common.operation.confirm')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Invalid password'
      })
    })
  })

  test('handles backup codes display correctly', async () => {
    const { get, post } = require('@/service/base')
    
    get.mockResolvedValue({ enabled: false })
    post.mockImplementation((url) => {
      if (url.includes('/setup') && !url.includes('/complete')) {
        return Promise.resolve({
          secret: 'TEST_SECRET',
          qr_code: 'data:image/png;base64,test'
        })
      } else if (url.includes('/setup/complete')) {
        return Promise.resolve({
          message: 'MFA setup successfully',
          backup_codes: ['ABCD1234', 'EFGH5678', 'IJKL9012', 'MNOP3456', 'QRST7890', 'UVWX1234', 'YZAB5678', 'CDEF9012'],
          setup_at: '2025-01-01T12:00:00'
        })
      }
    })

    render(<MFAPage />, { wrapper })
    
    // Setup MFA
    await waitFor(() => {
      fireEvent.click(screen.getByText('mfa.enable'))
    })

    await waitFor(() => {
      expect(screen.getByAltText('MFA QR Code')).toBeInTheDocument()
    })

    // Enter TOTP code
    const inputs = screen.getAllByRole('textbox')
    '123456'.split('').forEach((digit, index) => {
      fireEvent.change(inputs[index], { target: { value: digit } })
    })

    // Verify
    const verifyButton = screen.getByRole('button', { name: /verify|mfa.verify/i })
    fireEvent.click(verifyButton)

    // Check backup codes are displayed
    await waitFor(() => {
      expect(screen.getByText('mfa.backupCodes')).toBeInTheDocument()
      expect(screen.getByText('ABCD1234')).toBeInTheDocument()
      expect(screen.getByText('EFGH5678')).toBeInTheDocument()
    })
  })
})