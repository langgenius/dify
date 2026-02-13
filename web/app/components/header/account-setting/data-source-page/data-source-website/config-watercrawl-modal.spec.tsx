'use client'

import type { ReactNode } from 'react'
import type { CommonResponse } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { createDataSourceApiKeyBinding } from '@/service/datasets'
import ConfigWatercrawlModal from './config-watercrawl-modal'

/**
 * Mocking dependencies to isolate the ConfigWatercrawlModal component.
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
  PortalToFollowElem: ({ children }: { children: ReactNode }) => <div data-testid="portal">{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: ReactNode }) => <div data-testid="portal-content">{children}</div>,
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
 * Mock react-i18next to return translation keys instead of localized strings.
 * This makes tests deterministic and independent of locale changes.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('ConfigWatercrawlModal Component', () => {
  const mockOnCancel = vi.fn()
  const mockOnSaved = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test case: Verify initial rendering of the modal and its components.
   */
  it('should render the modal with all fields and buttons', () => {
    render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    // Verify title and static content using translation keys
    expect(screen.getByText('watercrawl.configWatercrawl')).toBeInTheDocument()
    expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'operation.cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'operation.save' })).toBeInTheDocument()

    // Verify the "Get API Key" link
    const link = screen.getByRole('link', { name: /watercrawl\.getApiKeyLinkText/i })
    expect(link).toHaveAttribute('href', 'https://app.watercrawl.dev/')
  })

  /**
   * Test case: Verify updates to input fields using userEvent for realistic interaction.
   */
  it('should update state when input fields change', async () => {
    const user = userEvent.setup()
    render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const apiKeyInput = screen.getByLabelText('API Key')
    const baseUrlInput = screen.getByLabelText('Base URL')

    await user.type(apiKeyInput, 'water-key')
    await user.type(baseUrlInput, 'https://custom.watercrawl.dev')

    expect(apiKeyInput).toHaveValue('water-key')
    expect(baseUrlInput).toHaveValue('https://custom.watercrawl.dev')
  })

  /**
   * Test case: Verify validation error when API Key is missing.
   * Covers branches for error validation logic.
   */
  it('should show error when saving without API Key', async () => {
    const user = userEvent.setup()
    render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const saveButton = screen.getByRole('button', { name: 'operation.save' })
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
   * Test case: Verify validation error for invalid Base URL format.
   * Covers URL validation branches.
   */
  it('should show error for invalid Base URL format', async () => {
    const user = userEvent.setup()
    render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const baseUrlInput = screen.getByLabelText('Base URL')
    const saveButton = screen.getByRole('button', { name: 'operation.save' })

    // Invalid format (not starting with http:// or https://)
    await user.type(baseUrlInput, 'ftp://invalid-url.com')
    await user.click(saveButton)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('errorMsg.urlError'),
      }))
    })
    expect(createDataSourceApiKeyBinding).not.toHaveBeenCalled()
  })

  /**
   * Test case: Verify successful save operation with valid input.
   * Covers happy path and credential structure.
   */
  it('should save successfully with valid API Key and custom URL', async () => {
    const user = userEvent.setup()
    vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })

    render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const apiKeyInput = screen.getByLabelText('API Key')
    const baseUrlInput = screen.getByLabelText('Base URL')
    const saveButton = screen.getByRole('button', { name: 'operation.save' })

    await user.type(apiKeyInput, 'valid-water-key')
    await user.type(baseUrlInput, 'http://my-watercrawl.com')
    await user.click(saveButton)

    await waitFor(() => {
      expect(createDataSourceApiKeyBinding).toHaveBeenCalledWith({
        category: 'website',
        provider: 'watercrawl',
        credentials: {
          auth_type: 'x-api-key',
          config: {
            api_key: 'valid-water-key',
            base_url: 'http://my-watercrawl.com',
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
   * Test case: Verify save operation uses default Base URL if none provided.
   * Covers the fallback logic for base_url.
   */
  it('should use default Base URL if none is provided during save', async () => {
    const user = userEvent.setup()
    vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })

    render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const apiKeyInput = screen.getByLabelText('API Key')
    const saveButton = screen.getByRole('button', { name: 'operation.save' })

    await user.type(apiKeyInput, 'test-api-key')
    await user.click(saveButton)

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

  /**
   * Test case: Verify onCancel is called when clicking the cancel button.
   */
  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const cancelButton = screen.getByRole('button', { name: 'operation.cancel' })
    await user.click(cancelButton)

    expect(mockOnCancel).toHaveBeenCalled()
  })

  /**
   * Test case: Verify that multiple clicks on save are ignored while saving.
   * Covers the isSaving re-entrancy branch.
   */
  it('should ignore multiple save clicks while saving is in progress', async () => {
    const user = userEvent.setup()
    let resolveSave: (value: CommonResponse) => void
    const savePromise = new Promise<CommonResponse>((resolve) => {
      resolveSave = resolve
    })
    vi.mocked(createDataSourceApiKeyBinding).mockReturnValue(savePromise)

    render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const apiKeyInput = screen.getByLabelText('API Key')
    const saveButton = screen.getByRole('button', { name: 'operation.save' })

    await user.type(apiKeyInput, 'test-api-key')

    // Trigger save twice rapidly
    await user.click(saveButton)
    await user.click(saveButton)

    expect(createDataSourceApiKeyBinding).toHaveBeenCalledTimes(1)

    // Finish the save to clear the state
    resolveSave!({ result: 'success' })

    await waitFor(() => {
      expect(mockOnSaved).toHaveBeenCalledTimes(1)
    })
  })

  /**
   * Test case: Verify branch coverage for https:// prefix in base_url
   */
  it('should accept base_url starting with https://', async () => {
    const user = userEvent.setup()
    vi.mocked(createDataSourceApiKeyBinding).mockResolvedValue({ result: 'success' })

    render(<ConfigWatercrawlModal onCancel={mockOnCancel} onSaved={mockOnSaved} />)

    const apiKeyInput = screen.getByLabelText('API Key')
    const baseUrlInput = screen.getByLabelText('Base URL')
    const saveButton = screen.getByRole('button', { name: 'operation.save' })

    await user.type(apiKeyInput, 'test-api-key')
    await user.type(baseUrlInput, 'https://secure-watercrawl.com')
    await user.click(saveButton)

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
