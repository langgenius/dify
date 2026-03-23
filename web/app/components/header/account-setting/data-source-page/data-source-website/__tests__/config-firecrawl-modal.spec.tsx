import type { CommonResponse } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { createDataSourceApiKeyBinding } from '@/service/datasets'
import ConfigFirecrawlModal from '../config-firecrawl-modal'

/**
 * ConfigFirecrawlModal Component Tests
 * Tests validation, save logic, and basic rendering for the Firecrawl configuration modal.
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

describe('ConfigFirecrawlModal Component', () => {
  const mockOnCancel = vi.fn()
  const mockOnSaved = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Rendering', () => {
    it('should render the modal with all fields and buttons', () => {
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      expect(screen.getByText('datasetCreation.firecrawl.configFirecrawl')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('datasetCreation.firecrawl.apiKeyPlaceholder')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('https://api.firecrawl.dev')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.save/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /datasetCreation\.firecrawl\.getApiKeyLinkText/i })).toHaveAttribute('href', 'https://www.firecrawl.dev/account')
    })
  })

  describe('Form Interactions', () => {
    it('should update state when input fields change', async () => {
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const apiKeyInput = screen.getByPlaceholderText('datasetCreation.firecrawl.apiKeyPlaceholder')
      const baseUrlInput = screen.getByPlaceholderText('https://api.firecrawl.dev')

      fireEvent.change(apiKeyInput, { target: { value: 'firecrawl-key' } })
      fireEvent.change(baseUrlInput, { target: { value: 'https://custom.firecrawl.dev' } })

      expect(apiKeyInput).toHaveValue('firecrawl-key')
      expect(baseUrlInput).toHaveValue('https://custom.firecrawl.dev')
    })

    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup()
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      await user.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      expect(mockOnCancel).toHaveBeenCalled()
    })
  })

  describe('Validation', () => {
    it('should show error when saving without API Key', async () => {
      const user = userEvent.setup()
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('common.errorMsg.fieldRequired:{"field":"common.provider.apiKey"}')
      })
      expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })

    it('should show error for invalid Base URL format', async () => {
      const user = userEvent.setup()
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      const baseUrlInput = screen.getByPlaceholderText('https://api.firecrawl.dev')

      await user.type(baseUrlInput, 'ftp://invalid-url.com')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('common.errorMsg.urlError')
      })
      expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
    })
  })

  describe('Saving Logic', () => {
    it('should save successfully with valid API Key and custom URL', async () => {
      const user = userEvent.setup()
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      await user.type(screen.getByPlaceholderText('datasetCreation.firecrawl.apiKeyPlaceholder'), 'valid-key')
      await user.type(screen.getByPlaceholderText('https://api.firecrawl.dev'), 'http://my-firecrawl.com')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

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
        expect(mockToastSuccess).toHaveBeenCalledWith('common.api.success')
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it('should use default Base URL if none is provided during save', async () => {
      const user = userEvent.setup()
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      await user.type(screen.getByPlaceholderText('datasetCreation.firecrawl.apiKeyPlaceholder'), 'test-key')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

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
      const user = userEvent.setup()
      let resolveSave: (value: CommonResponse) => void
      const savePromise = new Promise<CommonResponse>((resolve) => {
        resolveSave = resolve
      })
      vi.mocked(createDataSourceApiKeyBinding).mockReturnValue(savePromise)
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)
      await user.type(screen.getByPlaceholderText('datasetCreation.firecrawl.apiKeyPlaceholder'), 'test-key')
      const saveBtn = screen.getByRole('button', { name: /common\.operation\.save/i })

      await user.click(saveBtn)
      await user.click(saveBtn)

      expect(createDataSourceApiKeyBinding).toHaveBeenCalledTimes(1)

      resolveSave!({ result: 'success' })
      await waitFor(() => expect(mockOnSaved).toHaveBeenCalledTimes(1))
    })

    it('should accept base_url starting with https://', async () => {
      const user = userEvent.setup()
      vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })
      render(<ConfigFirecrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

      await user.type(screen.getByPlaceholderText('datasetCreation.firecrawl.apiKeyPlaceholder'), 'test-key')
      await user.type(screen.getByPlaceholderText('https://api.firecrawl.dev'), 'https://secure-firecrawl.com')
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

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
