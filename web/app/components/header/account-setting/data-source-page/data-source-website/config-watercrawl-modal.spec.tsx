import type { CommonResponse } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { createDataSourceApiKeyBinding } from '@/service/datasets'
import ConfigWatercrawlModal from './config-watercrawl-modal'

/**
 * ConfigWatercrawlModal Component Tests
 * Tests validation, save logic, and basic rendering for the Watercrawl configuration modal.
 */

vi.mock('@/service/datasets', () => ({
  createDataSourceApiKeyBinding: vi.fn(),
}))

describe('ConfigWatercrawlModal Component', () => {
  const mockOnCancel = vi.fn()
  const mockOnSaved = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Rendering', () => {
    it('should render the modal with all fields and buttons', () => {
      // Act
      render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Assert
      expect(screen.getByText('datasetCreation.watercrawl.configWatercrawl')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('datasetCreation.watercrawl.apiKeyPlaceholder')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('https://app.watercrawl.dev')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.save/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /datasetCreation\.watercrawl\.getApiKeyLinkText/i })).toHaveAttribute('href', 'https://app.watercrawl.dev/')
    })
  })

  describe('Form Interactions', () => {
    it('should update state when input fields change', async () => {
      // Arrange
      render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const apiKeyInput = screen.getByPlaceholderText('datasetCreation.watercrawl.apiKeyPlaceholder')
      const baseUrlInput = screen.getByPlaceholderText('https://app.watercrawl.dev')

      // Act
      fireEvent.change(apiKeyInput, { target: { value: 'water-key' } })
      fireEvent.change(baseUrlInput, { target: { value: 'https://custom.watercrawl.dev' } })

      // Assert
      expect(apiKeyInput).toHaveValue('water-key')
      expect(baseUrlInput).toHaveValue('https://custom.watercrawl.dev')
    })

    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })

  describe('Validation', () => {
    it('should show error when saving without API Key', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('common.errorMsg.fieldRequired:{"field":"API Key"}')).toBeInTheDocument()
      })
      expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })

    it('should show error for invalid Base URL format', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const baseUrlInput = screen.getByPlaceholderText('https://app.watercrawl.dev')

      // Act
      await user.type(baseUrlInput, 'ftp://invalid-url.com')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('common.errorMsg.urlError')).toBeInTheDocument()
      })
      expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })
  })

  describe('Saving Logic', () => {
    it('should save successfully with valid API Key and custom URL', async () => {
      const user = userEvent.setup()
      // Arrange
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.type(screen.getByPlaceholderText('datasetCreation.watercrawl.apiKeyPlaceholder'), 'valid-key')
      await user.type(screen.getByPlaceholderText('https://app.watercrawl.dev'), 'http://my-watercrawl.com')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(createDataSourceApiKeyBinding).toHaveBeenCalledWith({
          category: 'website',
          provider: 'watercrawl',
          credentials: {
            auth_type: 'x-api-key',
            config: {
              api_key: 'valid-key',
              base_url: 'http://my-watercrawl.com',
            },
          },
        })
      })
      await waitFor(() => {
        expect(screen.getByText('common.api.success')).toBeInTheDocument()
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it('should use default Base URL if none is provided during save', async () => {
      const user = userEvent.setup()
      // Arrange
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.type(screen.getByPlaceholderText('datasetCreation.watercrawl.apiKeyPlaceholder'), 'test-api-key')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(createDataSourceApiKeyBinding).toHaveBeenCalledWith(expect.objectContaining({
          credentials: expect.objectContaining({
            config: expect.objectContaining({
              base_url: 'https://app.watercrawl.dev',
            }),
          }),
        }))
      })
    })

    it('should ignore multiple save clicks while saving is in progress', async () => {
      const user = userEvent.setup()
      // Arrange
      let resolveSave: (value: CommonResponse) => void
      const savePromise = new Promise<CommonResponse>((resolve) => {
        resolveSave = resolve
      })
      vi.mocked(createDataSourceApiKeyBinding).mockReturnValue(savePromise)
      render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      await user.type(screen.getByPlaceholderText('datasetCreation.watercrawl.apiKeyPlaceholder'), 'test-api-key')
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
      const user = userEvent.setup()
      // Arrange
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.type(screen.getByPlaceholderText('datasetCreation.watercrawl.apiKeyPlaceholder'), 'test-api-key')
      await user.type(screen.getByPlaceholderText('https://app.watercrawl.dev'), 'https://secure-watercrawl.com')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(createDataSourceApiKeyBinding).toHaveBeenCalledWith(expect.objectContaining({
          credentials: expect.objectContaining({
            config: expect.objectContaining({
              base_url: 'https://secure-watercrawl.com',
            }),
          }),
        }))
      })
    })
  })
})
