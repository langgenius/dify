import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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

describe('ConfigJinaReaderModal Component', () => {
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
      expect(screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.save/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /datasetCreation\.jinaReader\.getApiKeyLinkText/i })).toHaveAttribute('href', 'https://jina.ai/reader/')
    })
  })

  describe('Form Interactions', () => {
    it('should update state when API Key field changes', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const apiKeyInput = screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder')

      // Act
      await user.type(apiKeyInput, 'jina-test-key')

      // Assert
      expect(apiKeyInput).toHaveValue('jina-test-key')
    })

    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup()
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
      const user = userEvent.setup()
      // Arrange
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      // Act
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('common.errorMsg.fieldRequired:{"field":"API Key"}')).toBeInTheDocument()
      })
      expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })
  })

  describe('Saving Logic', () => {
    it('should save successfully with valid API Key', async () => {
      const user = userEvent.setup()
      // Arrange
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const apiKeyInput = screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder')

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
        expect(screen.getByText('common.api.success')).toBeInTheDocument()
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it('should ignore multiple save clicks while saving is in progress', async () => {
      const user = userEvent.setup()
      // Arrange
      let resolveSave: (value: { result: 'success' }) => void
      const savePromise = new Promise<{ result: 'success' }>((resolve) => {
        resolveSave = resolve
      })
      vi.mocked(createDataSourceApiKeyBinding).mockReturnValue(savePromise)
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      await user.type(screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder'), 'test-key')
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
