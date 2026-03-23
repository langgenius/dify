import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DataSourceProvider } from '@/models/common'
import { createDataSourceApiKeyBinding } from '@/service/datasets'
import ConfigJinaReaderModal from '../config-jina-reader-modal'

/**
 * ConfigJinaReaderModal Component Tests
 * Tests validation, save logic, and basic rendering for the Jina Reader configuration modal.
 */

const { mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock('@/service/datasets', () => ({
  createDataSourceApiKeyBinding: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}))

describe('ConfigJinaReaderModal Component', () => {
  const mockOnCancel = vi.fn()
  const mockOnSaved = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Rendering', () => {
    it('should render the modal with API Key field and buttons', () => {
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

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
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const apiKeyInput = screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder')

      await user.type(apiKeyInput, 'jina-test-key')

      expect(apiKeyInput).toHaveValue('jina-test-key')
    })

    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup()
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      await user.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      expect(mockOnCancel).toHaveBeenCalled()
    })
  })

  describe('Validation', () => {
    it('should show error when saving without API Key', async () => {
      const user = userEvent.setup()
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('common.errorMsg.fieldRequired:{"field":"common.provider.apiKey"}')
      })
      expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })
  })

  describe('Saving Logic', () => {
    it('should save successfully with valid API Key', async () => {
      const user = userEvent.setup()
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const apiKeyInput = screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder')

      await user.type(apiKeyInput, 'valid-jina-key')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

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
        expect(mockToastSuccess).toHaveBeenCalledWith('common.api.success')
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it('should ignore multiple save clicks while saving is in progress', async () => {
      const user = userEvent.setup()
      let resolveSave: (value: { result: 'success' }) => void
      const savePromise = new Promise<{ result: 'success' }>((resolve) => {
        resolveSave = resolve
      })
      vi.mocked(createDataSourceApiKeyBinding).mockReturnValue(savePromise)
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      await user.type(screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder'), 'test-key')
      const saveBtn = screen.getByRole('button', { name: /common\.operation\.save/i })

      await user.click(saveBtn)
      await user.click(saveBtn)

      expect(createDataSourceApiKeyBinding).toHaveBeenCalledTimes(1)

      resolveSave!({ result: 'success' })
      await waitFor(() => expect(mockOnSaved).toHaveBeenCalledTimes(1))
    })

    it('should show encryption info and external link in the modal', async () => {
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      const pkcsLink = screen.getByText('PKCS1_OAEP')
      expect(pkcsLink.closest('a')).toHaveAttribute('href', 'https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html')

      const jinaLink = screen.getByRole('link', { name: /datasetCreation\.jinaReader\.getApiKeyLinkText/i })
      expect(jinaLink).toHaveAttribute('target', '_blank')
    })

    it('should return early when save is clicked while already saving (isSaving guard)', async () => {
      const user = userEvent.setup()
      let resolveFirst: (value: { result: 'success' }) => void
      const neverResolves = new Promise<{ result: 'success' }>((resolve) => {
        resolveFirst = resolve
      })
      vi.mocked(createDataSourceApiKeyBinding).mockReturnValue(neverResolves)
      render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      const apiKeyInput = screen.getByPlaceholderText('datasetCreation.jinaReader.apiKeyPlaceholder')
      await user.type(apiKeyInput, 'valid-key')

      const saveBtn = screen.getByRole('button', { name: /common\.operation\.save/i })
      await user.click(saveBtn)
      expect(createDataSourceApiKeyBinding).toHaveBeenCalledTimes(1)

      const { fireEvent: fe } = await import('@testing-library/react')
      fe.click(saveBtn)
      expect(createDataSourceApiKeyBinding).toHaveBeenCalledTimes(1)

      resolveFirst!({ result: 'success' })
      await waitFor(() => expect(mockOnSaved).toHaveBeenCalled())
    })
  })
})
