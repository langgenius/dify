import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MFAPage from './mfa-page'

// Mock the translation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock the MFA service
jest.mock('@/service/use-mfa', () => ({
  mfaService: {
    getStatus: jest.fn(),
    setupInit: jest.fn(),
    setupComplete: jest.fn(),
    disable: jest.fn(),
  },
}))

// Mock the Toast component
jest.mock('@/app/components/base/toast', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    success: jest.fn(),
  },
}))

describe('MFAPage Component', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  const renderMFAPage = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MFAPage />
      </QueryClientProvider>
    )
  }

  test('renders loading state initially', () => {
    const { mfaService } = require('@/service/use-mfa')
    mfaService.getStatus.mockImplementation(() => new Promise(() => {})) // Never resolves

    renderMFAPage()
    
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  test('renders enable button when MFA is disabled', async () => {
    const { mfaService } = require('@/service/use-mfa')
    mfaService.getStatus.mockResolvedValue({ enabled: false })

    renderMFAPage()
    
    await waitFor(() => {
      expect(screen.getByText('common.settings.mfaEnable')).toBeInTheDocument()
    })
  })

  test('renders disable button when MFA is enabled', async () => {
    const { mfaService } = require('@/service/use-mfa')
    mfaService.getStatus.mockResolvedValue({ 
      enabled: true,
      setup_at: '2025-01-01T12:00:00'
    })

    renderMFAPage()
    
    await waitFor(() => {
      expect(screen.getByText('common.settings.mfaDisable')).toBeInTheDocument()
    })
  })

  test('opens setup modal when enable button is clicked', async () => {
    const { mfaService } = require('@/service/use-mfa')
    mfaService.getStatus.mockResolvedValue({ enabled: false })
    mfaService.setupInit.mockResolvedValue({
      secret: 'TEST_SECRET',
      qr_code: 'data:image/png;base64,test'
    })

    renderMFAPage()
    
    await waitFor(() => {
      expect(screen.getByText('common.settings.mfaEnable')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('common.settings.mfaEnable'))

    await waitFor(() => {
      expect(screen.getByText('mfa.setup.title')).toBeInTheDocument()
    })
  })

  test('completes MFA setup successfully', async () => {
    const { mfaService } = require('@/service/use-mfa')
    const Toast = require('@/app/components/base/toast').default
    
    mfaService.getStatus.mockResolvedValue({ enabled: false })
    mfaService.setupInit.mockResolvedValue({
      secret: 'TEST_SECRET',
      qr_code: 'data:image/png;base64,test'
    })
    mfaService.setupComplete.mockResolvedValue({
      message: 'Success',
      backup_codes: ['CODE1', 'CODE2', 'CODE3']
    })

    renderMFAPage()
    
    // Click enable
    await waitFor(() => {
      fireEvent.click(screen.getByText('common.settings.mfaEnable'))
    })

    // Enter TOTP code
    await waitFor(() => {
      const input = screen.getByPlaceholderText('mfa.setup.totpPlaceholder')
      fireEvent.change(input, { target: { value: '123456' } })
    })

    // Click next
    fireEvent.click(screen.getByText('common.operation.next'))

    await waitFor(() => {
      expect(Toast.success).toHaveBeenCalledWith('mfa.setup.success')
    })
  })

  test('shows error when setup fails', async () => {
    const { mfaService } = require('@/service/use-mfa')
    const Toast = require('@/app/components/base/toast').default
    
    mfaService.getStatus.mockResolvedValue({ enabled: false })
    mfaService.setupInit.mockResolvedValue({
      secret: 'TEST_SECRET',
      qr_code: 'data:image/png;base64,test'
    })
    mfaService.setupComplete.mockRejectedValue(new Error('Invalid TOTP'))

    renderMFAPage()
    
    // Click enable
    await waitFor(() => {
      fireEvent.click(screen.getByText('common.settings.mfaEnable'))
    })

    // Enter TOTP code
    await waitFor(() => {
      const input = screen.getByPlaceholderText('mfa.setup.totpPlaceholder')
      fireEvent.change(input, { target: { value: 'wrong' } })
    })

    // Click next
    fireEvent.click(screen.getByText('common.operation.next'))

    await waitFor(() => {
      expect(Toast.error).toHaveBeenCalledWith('Invalid TOTP')
    })
  })

  test('disables MFA successfully', async () => {
    const { mfaService } = require('@/service/use-mfa')
    const Toast = require('@/app/components/base/toast').default
    
    mfaService.getStatus.mockResolvedValue({ 
      enabled: true,
      setup_at: '2025-01-01T12:00:00'
    })
    mfaService.disable.mockResolvedValue({ message: 'Success' })

    renderMFAPage()
    
    // Click disable
    await waitFor(() => {
      fireEvent.click(screen.getByText('common.settings.mfaDisable'))
    })

    // Enter password
    await waitFor(() => {
      const input = screen.getByPlaceholderText('mfa.disable.passwordPlaceholder')
      fireEvent.change(input, { target: { value: 'password123' } })
    })

    // Click confirm
    fireEvent.click(screen.getByText('common.operation.confirm'))

    await waitFor(() => {
      expect(Toast.success).toHaveBeenCalledWith('mfa.disable.success')
    })
  })
})