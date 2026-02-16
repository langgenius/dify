'use client'

import type { ReactNode } from 'react'
import type { CommonResponse } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { createDataSourceApiKeyBinding } from '@/service/datasets'
import ConfigFirecrawlModal from './config-firecrawl-modal'

/**
 * ConfigFirecrawlModal Component Tests
 * Tests validation, save logic, and basic rendering for the Firecrawl configuration modal.
 */

vi.mock('@/service/datasets', () => ({
  createDataSourceApiKeyBinding: vi.fn(),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children }: { children: ReactNode }) => <div data-testid="portal">{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: ReactNode }) => <div data-testid="portal-content">{children}</div>,
}))

// Mock Field component to provide a simpler interface for testing interaction
vi.mock('@/app/components/datasets/create/website/base/field', () => ({
  default: ({ label, value, onChange, placeholder }: { label: string, value: string | number, onChange: (v: string | number) => void, placeholder?: string }) => (
    <div>
      <label htmlFor={label}>{label}</label>
      <input
        id={label}
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  ),
}))

describe('ConfigFirecrawlModal Component', () => {
  const user = userEvent.setup()
  const mockOnCancel = vi.fn()
  const mockOnSaved = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Rendering', () => {
    it('should render the modal with all fields and buttons', () => {
      // Act
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Assert
      expect(screen.getByText('datasetCreation.firecrawl.configFirecrawl')).toBeInTheDocument()
      expect(screen.getByLabelText('API Key')).toBeInTheDocument()
      expect(screen.getByLabelText('Base URL')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.save/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /datasetCreation\.firecrawl\.getApiKeyLinkText/i })).toHaveAttribute('href', 'https://www.firecrawl.dev/account')
    })
  })

  describe('Form Interactions', () => {
    it('should update state when input fields change', async () => {
      // Arrange
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const apiKeyInput = screen.getByLabelText('API Key')
      const baseUrlInput = screen.getByLabelText('Base URL')

      // Act
      await user.type(apiKeyInput, 'firecrawl-key')
      await user.type(baseUrlInput, 'https://custom.firecrawl.dev')

      // Assert
      expect(apiKeyInput).toHaveValue('firecrawl-key')
      expect(baseUrlInput).toHaveValue('https://custom.firecrawl.dev')
    })

    it('should call onCancel when cancel button is clicked', async () => {
      // Arrange
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })

  describe('Validation', () => {
    it('should show error when saving without API Key', async () => {
      // Arrange
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
          message: 'common.errorMsg.fieldRequired:{"field":"API Key"}',
        }))
      })
      expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })

    it('should show error for invalid Base URL format', async () => {
      // Arrange
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const baseUrlInput = screen.getByLabelText('Base URL')

      // Act
      await user.type(baseUrlInput, 'ftp://invalid-url.com')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
          message: 'common.errorMsg.urlError',
        }))
      })
      expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })
  })

  describe('Saving Logic', () => {
    it('should save successfully with valid API Key and custom URL', async () => {
      // Arrange
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.type(screen.getByLabelText('API Key'), 'valid-key')
      await user.type(screen.getByLabelText('Base URL'), 'http://my-firecrawl.com')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(createDataSourceApiKeyBinding).toHaveBeenCalledWith({
          category: 'website',
          provider: 'firecrawl',
          credentials: {
            auth_type: 'bearer',
            config: {
              api_key: 'valid-key',
              base_url: 'http://my-firecrawl.com',
            },
          },
        })
      })
      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: 'common.api.success' }))
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it('should use default Base URL if none is provided during save', async () => {
      // Arrange
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.type(screen.getByLabelText('API Key'), 'test-key')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(createDataSourceApiKeyBinding).toHaveBeenCalledWith(expect.objectContaining({
          credentials: expect.objectContaining({
            config: expect.objectContaining({
              base_url: 'https://api.firecrawl.dev',
            }),
          }),
        }))
      })
    })

    it('should ignore multiple save clicks while saving is in progress', async () => {
      // Arrange
      let resolveSave: (value: CommonResponse) => void
      const savePromise = new Promise<CommonResponse>((resolve) => {
        resolveSave = resolve
      })
      vi.mocked(createDataSourceApiKeyBinding).mockReturnValue(savePromise)
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      await user.type(screen.getByLabelText('API Key'), 'test-key')
      const saveBtn = screen.getByRole('button', { name: /common\.operation\.save/i })

      // Act
      await user.click(saveBtn)
      await user.click(saveBtn)

      // Assert
      expect(createDataSourceApiKeyBinding).toHaveBeenCalledTimes(1)

      // Cleanup
      resolveSave!({ result: 'success' })
      await waitFor(() => expect(mockOnSaved).toHaveBeenCalledTimes(1))
    })

    it('should accept base_url starting with https://', async () => {
      // Arrange
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.type(screen.getByLabelText('API Key'), 'test-key')
      await user.type(screen.getByLabelText('Base URL'), 'https://secure-firecrawl.com')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(createDataSourceApiKeyBinding).toHaveBeenCalledWith(expect.objectContaining({
          credentials: expect.objectContaining({
            config: expect.objectContaining({
              base_url: 'https://secure-firecrawl.com',
            }),
          }),
        }))
      })
    })
  })
})
