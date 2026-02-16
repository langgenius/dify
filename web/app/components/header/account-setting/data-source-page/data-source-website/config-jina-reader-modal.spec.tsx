'use client'

import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { DataSourceProvider } from '@/models/common'
import { createDataSourceApiKeyBinding } from '@/service/datasets'
import ConfigJinaReaderModal from './config-jina-reader-modal'

/**
 * ConfigJinaReaderModal Component Tests
 * Tests validation, save logic, and basic rendering for the Jina Reader configuration modal.
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

describe('ConfigJinaReaderModal Component', () => {
  const user = userEvent.setup()
  const mockOnCancel = vi.fn()
  const mockOnSaved = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Rendering', () => {
    it('should render the modal with API Key field and buttons', () => {
      // Act
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Assert
      expect(screen.getByText('datasetCreation.jinaReader.configJinaReader')).toBeInTheDocument()
      expect(screen.getByLabelText('API Key')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.save/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /datasetCreation\.jinaReader\.getApiKeyLinkText/i })).toHaveAttribute('href', 'https://jina.ai/reader/')
    })
  })

  describe('Form Interactions', () => {
    it('should update state when API Key field changes', async () => {
      // Arrange
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const apiKeyInput = screen.getByLabelText('API Key')

      // Act
      await user.type(apiKeyInput, 'jina-test-key')

      // Assert
      expect(apiKeyInput).toHaveValue('jina-test-key')
    })

    it('should call onCancel when cancel button is clicked', async () => {
      // Arrange
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })

  describe('Validation', () => {
    it('should show error when saving without API Key', async () => {
      // Arrange
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

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
  })

  describe('Saving Logic', () => {
    it('should save successfully with valid API Key', async () => {
      // Arrange
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const apiKeyInput = screen.getByLabelText('API Key')

      // Act
      await user.type(apiKeyInput, 'valid-jina-key')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(createDataSourceApiKeyBinding).toHaveBeenCalledWith({
          category: 'website',
          provider: DataSourceProvider.jinaReader,
          credentials: {
            auth_type: 'bearer',
            config: {
              api_key: 'valid-jina-key',
            },
          },
        })
      })
      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: 'common.api.success' }))
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it('should ignore multiple save clicks while saving is in progress', async () => {
      // Arrange
      let resolveSave: (value: { result: 'success' }) => void
      const savePromise = new Promise<{ result: 'success' }>((resolve) => {
        resolveSave = resolve
      })
      vi.mocked(createDataSourceApiKeyBinding).mockReturnValue(savePromise)
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
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
  })
})
