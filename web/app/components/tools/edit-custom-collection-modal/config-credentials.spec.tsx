import type { Credential } from '@/app/components/tools/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthHeaderPrefix, AuthType } from '@/app/components/tools/types'
import ConfigCredential from './config-credentials'

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
  describe('Rendering', () => {
    it('should render without crashing', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      expect(screen.getByText('tools.createTool.authMethod.title')).toBeInTheDocument()
    })

    it('should render all three auth type options', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      expect(screen.getByText('tools.createTool.authMethod.types.none')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.authMethod.types.api_key_header')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.authMethod.types.api_key_query')).toBeInTheDocument()
    })

    it('should render with positionCenter prop', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            positionCenter
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      expect(screen.getByText('tools.createTool.authMethod.title')).toBeInTheDocument()
    })
  })

  // Tests for cancel and save buttons
  describe('Cancel and Save Actions', () => {
    it('should call onHide when cancel is pressed', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      fireEvent.click(screen.getByText('common.operation.cancel'))

      expect(mockOnHide).toHaveBeenCalledTimes(1)
      expect(mockOnChange).not.toHaveBeenCalled()
    })

    it('should call both onChange and onHide when save is pressed', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      fireEvent.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledTimes(1)
      expect(mockOnHide).toHaveBeenCalledTimes(1)
    })
  })

  // Tests for "none" auth type selection
  describe('None Auth Type', () => {
    it('should select none auth type and save', async () => {
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
      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.none'))
      fireEvent.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.none,
      })
    })
  })

  // Tests for API Key Header auth type
  describe('API Key Header Auth Type', () => {
    it('should select apiKeyHeader and show header prefix options', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))

      // Header prefix options should appear
      expect(screen.getByText('tools.createTool.authHeaderPrefix.types.basic')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.authHeaderPrefix.types.bearer')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.authHeaderPrefix.types.custom')).toBeInTheDocument()
    })

    it('should submit apiKeyHeader credential with default values', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      const headerInput = screen.getByPlaceholderText('tools.createTool.authMethod.types.apiKeyPlaceholder')
      const valueInput = screen.getByPlaceholderText('tools.createTool.authMethod.types.apiValuePlaceholder')
      fireEvent.change(headerInput, { target: { value: 'X-Auth' } })
      fireEvent.change(valueInput, { target: { value: 'sEcReT' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.apiKeyHeader,
        api_key_header: 'X-Auth',
        api_key_header_prefix: AuthHeaderPrefix.custom,
        api_key_value: 'sEcReT',
      })
      expect(mockOnHide).toHaveBeenCalled()
    })

    it('should select basic header prefix', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      fireEvent.click(screen.getByText('tools.createTool.authHeaderPrefix.types.basic'))
      fireEvent.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_type: AuthType.apiKeyHeader,
          api_key_header_prefix: AuthHeaderPrefix.basic,
        }),
      )
    })

    it('should select bearer header prefix', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      fireEvent.click(screen.getByText('tools.createTool.authHeaderPrefix.types.bearer'))
      fireEvent.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_type: AuthType.apiKeyHeader,
          api_key_header_prefix: AuthHeaderPrefix.bearer,
        }),
      )
    })

    it('should select custom header prefix', async () => {
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
      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      // Select bearer first, then custom to test switching
      fireEvent.click(screen.getByText('tools.createTool.authHeaderPrefix.types.bearer'))
      fireEvent.click(screen.getByText('tools.createTool.authHeaderPrefix.types.custom'))
      fireEvent.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_type: AuthType.apiKeyHeader,
          api_key_header_prefix: AuthHeaderPrefix.custom,
        }),
      )
    })

    it('should preserve existing values when switching to apiKeyHeader', async () => {
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

      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
      fireEvent.click(screen.getByText('common.operation.save'))

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
    it('should select apiKeyQuery and show query param input', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_query'))

      // Query param input should appear
      expect(screen.getByPlaceholderText('tools.createTool.authMethod.types.queryParamPlaceholder')).toBeInTheDocument()
    })

    it('should submit apiKeyQuery credential with default values', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_query'))
      fireEvent.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.apiKeyQuery,
        api_key_query_param: 'key',
        api_key_value: '',
      })
    })

    it('should edit query param name and value', async () => {
      await act(async () => {
        render(
          <ConfigCredential
            credential={baseCredential}
            onChange={mockOnChange}
            onHide={mockOnHide}
          />,
        )
      })

      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_query'))

      const queryParamInput = screen.getByPlaceholderText('tools.createTool.authMethod.types.queryParamPlaceholder')
      const valueInput = screen.getByPlaceholderText('tools.createTool.authMethod.types.apiValuePlaceholder')

      fireEvent.change(queryParamInput, { target: { value: 'api_key' } })
      fireEvent.change(valueInput, { target: { value: 'my-secret-key' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.apiKeyQuery,
        api_key_query_param: 'api_key',
        api_key_value: 'my-secret-key',
      })
    })

    it('should preserve existing values when switching to apiKeyQuery', async () => {
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

      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_query'))
      fireEvent.click(screen.getByText('common.operation.save'))

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
      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_query'))

      // Header prefix options should disappear
      expect(screen.queryByText('tools.createTool.authHeaderPrefix.types.basic')).not.toBeInTheDocument()

      // Query param input should appear
      expect(screen.getByPlaceholderText('tools.createTool.authMethod.types.queryParamPlaceholder')).toBeInTheDocument()
    })

    it('should switch from apiKeyQuery to none', async () => {
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
      fireEvent.click(screen.getByText('tools.createTool.authMethod.types.none'))
      fireEvent.click(screen.getByText('common.operation.save'))

      expect(mockOnChange).toHaveBeenCalledWith({
        auth_type: AuthType.none,
      })
    })
  })

  // Tests for initial credential state
  describe('Initial Credential State', () => {
    it('should show apiKeyHeader fields when initial auth type is apiKeyHeader', async () => {
      const headerCredential: Credential = {
        auth_type: AuthType.apiKeyHeader,
        api_key_header: 'X-Custom-Header',
        api_key_value: 'secret123',
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

      // Header inputs should be visible with initial values
      const headerInput = screen.getByPlaceholderText('tools.createTool.authMethod.types.apiKeyPlaceholder')
      expect(headerInput).toHaveValue('X-Custom-Header')
    })

    it('should show apiKeyQuery fields when initial auth type is apiKeyQuery', async () => {
      const queryCredential: Credential = {
        auth_type: AuthType.apiKeyQuery,
        api_key_query_param: 'apikey',
        api_key_value: 'queryvalue',
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

      // Query param input should be visible with initial value
      const queryParamInput = screen.getByPlaceholderText('tools.createTool.authMethod.types.queryParamPlaceholder')
      expect(queryParamInput).toHaveValue('apikey')
    })
  })
})
