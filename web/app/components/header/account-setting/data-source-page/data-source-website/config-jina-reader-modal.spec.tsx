'use client'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { DataSourceProvider } from '@/models/common'
import { createDataSourceApiKeyBinding } from '@/service/datasets'
import ConfigJinaReaderModal from './config-jina-reader-modal'

/**
 * Mocking dependencies to isolate the ConfigJinaReaderModal component.
 */

// Mock the service call for creating API key binding
vi.mock('@/service/datasets', () => ({
  createDataSourceApiKeyBinding: vi.fn(),
}))

// Mock Toast for notifications
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

/**
 * Mocking Portal components to ensure content is rendered in the testing DOM.
 */
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children }: { children: React.ReactNode }) => <div data-testid="portal">{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div data-testid="portal-content">{children}</div>,
}))

/**
 * Mocking Field component to provide a simpler interface for testing interaction.
 */
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

/**
 * Internationalization (i18n) Behavior:
 *
 * react-i18next is globally mocked in vitest.setup.ts (via test/i18n-mock.ts).
 * The global mock returns translation keys in the format 'namespace.key' instead of
 * localized strings, making test assertions predictable and independent of locale.
 *
 * For example:
 *   t('jinaReader.configJinaReader', { ns: 'datasetCreation' }) → 'datasetCreation.jinaReader.configJinaReader'
 *   t('operation.save', { ns: 'common' }) → 'common.operation.save'
 *
 * This ensures that:
 * 1. Tests verify the correct translation keys are being used
 * 2. Tests remain stable regardless of translation file changes
 * 3. No additional mocking is needed in individual test files
 */

describe('ConfigJinaReaderModal Component', () => {
  const mockOnCancel = vi.fn()
  const mockOnSaved = vi.fn()
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    vi.clearAllMocks()
    // Setup userEvent for each test to ensure proper cleanup and isolation
    user = userEvent.setup()
  })

  /**
   * Test case: Verify initial rendering of the modal and its components.
   */
  it('should render the modal with API Key field and buttons', () => {
    render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    // Verify title and static content
    expect(screen.getByText('datasetCreation.jinaReader.configJinaReader')).toBeInTheDocument()
    expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    expect(screen.getByText('common.operation.save')).toBeInTheDocument()

    // Verify the "Get API Key" link
    const link = screen.getByRole('link', { name: /datasetCreation\.jinaReader\.getApiKeyLinkText/i })
    expect(link).toHaveAttribute('href', 'https://jina.ai/reader/')
    expect(link).toHaveAttribute('target', '_blank')
  })

  /**
   * Test case: Verify that API Key value is correctly updated.
   * Uses userEvent.type to simulate realistic typing behavior.
   */
  it('should update state when API Key field changes', async () => {
    render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const apiKeyInput = screen.getByLabelText('API Key')
    await user.type(apiKeyInput, 'jina-test-key')

    expect(apiKeyInput).toHaveValue('jina-test-key')
  })

  /**
   * Test case: Verify validation error when API Key is missing.
   * This covers the branch where apiKey is empty.
   */
  it('should show error when saving without API Key', async () => {
    render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const saveButton = screen.getByText('common.operation.save')
    await user.click(saveButton)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('errorMsg.fieldRequired'),
      }))
    })
    expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
  })

  /**
   * Test case: Verify successful save operation.
   * This covers the happy path and ensures postData is correctly structured.
   * Note: The finally block is also covered here as it resets isSaving.
   */
  it('should save successfully with valid API Key', async () => {
    vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })

    render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const apiKeyInput = screen.getByLabelText('API Key')
    const saveButton = screen.getByText('common.operation.save')

    await user.type(apiKeyInput, 'valid-jina-key')
    await user.click(saveButton)

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
      expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        message: expect.stringContaining('api.success'),
      }))
      expect(mockOnSaved).toHaveBeenCalled()
    })
  })

  /**
   * Test case: Verify onCancel is called when clicking the cancel button.
   */
  it('should call onCancel when cancel button is clicked', async () => {
    render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const cancelButton = screen.getByText('common.operation.cancel')
    await user.click(cancelButton)

    expect(mockOnCancel).toHaveBeenCalled()
  })

  /**
   * Test case: Verify that multiple clicks on save are ignored while saving.
   * This covers the branch 'if (isSaving) return'.
   */
  it('should ignore multiple save clicks while saving is in progress', async () => {
    let resolveSave: (value: { result: 'success' }) => void
    const savePromise = new Promise<{ result: 'success' }>((resolve) => {
      resolveSave = resolve
    })
    vi.mocked(createDataSourceApiKeyBinding).mockReturnValue(savePromise)

    render(<ConfigJinaReaderModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const apiKeyInput = screen.getByLabelText('API Key')
    const saveButton = screen.getByText('common.operation.save')

    await user.type(apiKeyInput, 'test-api-key')

    // Trigger save twice rapidly to test re-entrancy guard
    await user.click(saveButton)
    await user.click(saveButton)

    expect(createDataSourceApiKeyBinding).toHaveBeenCalledTimes(1)

    // Finalize the save
    resolveSave!({ result: 'success' })

    await waitFor(() => {
      expect(mockOnSaved).toHaveBeenCalledTimes(1)
    })
  })
})
