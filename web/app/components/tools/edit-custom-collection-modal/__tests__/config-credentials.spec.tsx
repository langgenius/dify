import type { Credential } from '@/app/components/tools/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AuthHeaderPrefix, AuthType } from '@/app/components/tools/types'
import ConfigCredential from '../config-credentials'

describe('ConfigCredential', () => {
  const baseCredential: Credential = {
    auth_type: AuthType.none,
  }
  const mockOnChange = vi.fn()
  const mockOnHide = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for basic rendering

  // Tests for cancel and save buttons
  describe('Cancel and Save Actions', () => {
    it('should call onHide when cancel is pressed', async () => {
      const user = userEvent.setup()
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      await user.click(screen.getByText('common.operation.cancel'))

      expect(mockOnHide).toHaveBeenCalledTimes(1)
      expect(mockOnChange).not.toHaveBeenCalled()
    })

    it('should call onHide when Escape is pressed', async () => {
      const user = userEvent.setup()
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(mockOnHide).toHaveBeenCalledTimes(1)
      })
      expect(mockOnChange).not.toHaveBeenCalled()
    })
  })

  // Tests for "none" auth type selection
  describe('None Auth Type', () => {
    it('should select none auth type and save', async () => {
      const user = userEvent.setup()
      const credentialWithApiKey: Credential = {
        auth_type: AuthType.apiKeyHeader,
        api_key_header: 'X-Api-Key',
        api_key_value: 'test-value',
        api_key_header_prefix: AuthHeaderPrefix.bearer,
      }

      await act(async () => {
        render(
          <ConfigCredential
            credential={credentialWithApiKey}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      // Switch to none auth type
      await user.click(screen.getByText('tools.createTool.authMethod.types.none'))
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.none,
      })
    })
  })

  // Tests for API Key Header auth type
  describe('API Key Header Auth Type', () => {
    it('should submit apiKeyHeader credential with default values', async () => {
      const user = userEvent.setup()
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      await user.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      const headerInput = screen.getByPlaceholderText(
        'tools.createTool.authMethod.types.apiKeyPlaceholder',
      )
      const valueInput = screen.getByPlaceholderText(
        'tools.createTool.authMethod.types.apiValuePlaceholder',
      )
      await user.clear(headerInput)
      await user.type(headerInput, 'X-Auth')
      await user.clear(valueInput)
      await user.type(valueInput, 'sEcReT')
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.apiKeyHeader,
        api_key_header: 'X-Auth',
        api_key_header_prefix: AuthHeaderPrefix.custom,
        api_key_value: 'sEcReT',
      })
      expect(mockOnHide).toHaveBeenCalled()
    })

    it('should select basic header prefix', async () => {
      const user = userEvent.setup()
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      await user.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      await user.click(screen.getByText('tools.createTool.authHeaderPrefix.types.basic'))
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_type: AuthType.apiKeyHeader,
          api_key_header_prefix: AuthHeaderPrefix.basic,
        }),
      )
    })

    it('should select bearer header prefix', async () => {
      const user = userEvent.setup()
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      await user.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      await user.click(screen.getByText('tools.createTool.authHeaderPrefix.types.bearer'))
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_type: AuthType.apiKeyHeader,
          api_key_header_prefix: AuthHeaderPrefix.bearer,
        }),
      )
    })

    it('should select custom header prefix', async () => {
      const user = userEvent.setup()
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      // Start with none, switch to apiKeyHeader (which defaults to custom)
      await user.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      // Select bearer first, then custom to test switching
      await user.click(screen.getByText('tools.createTool.authHeaderPrefix.types.bearer'))
      await user.click(screen.getByText('tools.createTool.authHeaderPrefix.types.custom'))
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_type: AuthType.apiKeyHeader,
          api_key_header_prefix: AuthHeaderPrefix.custom,
        }),
      )
    })

    it('should preserve existing values when switching to apiKeyHeader', async () => {
      const user = userEvent.setup()
      const existingCredential: Credential = {
        auth_type: AuthType.none,
        api_key_header: 'Existing-Header',
        api_key_value: 'existing-value',
        api_key_header_prefix: AuthHeaderPrefix.bearer,
      }

      await act(async () => {
        render(
          <ConfigCredential
            credential={existingCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      await user.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_type: AuthType.apiKeyHeader,
          api_key_header: 'Existing-Header',
          api_key_value: 'existing-value',
          api_key_header_prefix: AuthHeaderPrefix.bearer,
        }),
      )
    })
  })

  // Tests for API Key Query auth type
  describe('API Key Query Auth Type', () => {
    it('should submit apiKeyQuery credential with default values', async () => {
      const user = userEvent.setup()
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      await user.click(screen.getByText('tools.createTool.authMethod.types.api_key_query'))
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.apiKeyQuery,
        api_key_query_param: 'key',
        api_key_value: '',
      })
    })

    it('should edit query param name and value', async () => {
      const user = userEvent.setup()
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      await user.click(screen.getByText('tools.createTool.authMethod.types.api_key_query'))

      const queryParamInput = screen.getByPlaceholderText(
        'tools.createTool.authMethod.types.queryParamPlaceholder',
      )
      const valueInput = screen.getByPlaceholderText(
        'tools.createTool.authMethod.types.apiValuePlaceholder',
      )

      await user.clear(queryParamInput)
      await user.type(queryParamInput, 'api_key')
      await user.clear(valueInput)
      await user.type(valueInput, 'my-secret-key')
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.apiKeyQuery,
        api_key_query_param: 'api_key',
        api_key_value: 'my-secret-key',
      })
    })

    it('should preserve existing values when switching to apiKeyQuery', async () => {
      const user = userEvent.setup()
      const existingCredential: Credential = {
        auth_type: AuthType.none,
        api_key_query_param: 'existing_param',
        api_key_value: 'existing-value',
      }

      await act(async () => {
        render(
          <ConfigCredential
            credential={existingCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      await user.click(screen.getByText('tools.createTool.authMethod.types.api_key_query'))
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_type: AuthType.apiKeyQuery,
          api_key_query_param: 'existing_param',
          api_key_value: 'existing-value',
        }),
      )
    })
  })

  // Tests for switching between auth types
  describe('Switching Auth Types', () => {
    it('should switch from apiKeyHeader to apiKeyQuery', async () => {
      const user = userEvent.setup()
      const headerCredential: Credential = {
        auth_type: AuthType.apiKeyHeader,
        api_key_header: 'Authorization',
        api_key_value: 'Bearer token',
        api_key_header_prefix: AuthHeaderPrefix.bearer,
      }

      await act(async () => {
        render(
          <ConfigCredential
            credential={headerCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      // Switch to query
      await user.click(screen.getByText('tools.createTool.authMethod.types.api_key_query'))

      // Header prefix options should disappear
      expect(
        screen.queryByText('tools.createTool.authHeaderPrefix.types.basic'),
      ).not.toBeInTheDocument()

      // Query param input should appear
      expect(
        screen.getByPlaceholderText('tools.createTool.authMethod.types.queryParamPlaceholder'),
      ).toBeInTheDocument()
    })

    it('should switch from apiKeyQuery to none', async () => {
      const user = userEvent.setup()
      const queryCredential: Credential = {
        auth_type: AuthType.apiKeyQuery,
        api_key_query_param: 'key',
        api_key_value: 'value',
      }

      await act(async () => {
        render(
          <ConfigCredential
            credential={queryCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      // Switch to none
      await user.click(screen.getByText('tools.createTool.authMethod.types.none'))
      await user.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.none,
      })
    })
  })

  // Tests for initial credential state
})
