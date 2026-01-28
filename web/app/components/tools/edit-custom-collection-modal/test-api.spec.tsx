import type { CustomCollectionBackend, CustomParamSchema } from '@/app/components/tools/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthHeaderPrefix, AuthType } from '@/app/components/tools/types'
import { testAPIAvailable } from '@/service/tools'
import TestApi from './test-api'

vi.mock('@/service/tools', () => ({
  testAPIAvailable: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(() => 'en-US'),
}))

const testAPIAvailableMock = vi.mocked(testAPIAvailable)

describe('TestApi', () => {
  const customCollection: CustomCollectionBackend = {
    provider: 'custom',
    credentials: {
      auth_type: AuthType.none,
    },
    schema_type: 'openapi',
    schema: '{ }',
    icon: { background: '', content: '' },
    privacy_policy: '',
    custom_disclaimer: '',
    id: 'test-id',
    labels: [],
  }

  const tool: CustomParamSchema = {
    operation_id: 'testOp',
    summary: 'summary',
    method: 'GET',
    server_url: 'https://api.example.com',
    parameters: [{
      name: 'limit',
      label: {
        en_US: 'Limit',
        zh_Hans: '限制',
      },
    } as CustomParamSchema['parameters'][0]],
  }

  const mockOnHide = vi.fn()

  const renderTestApi = (props?: {
    customCollection?: CustomCollectionBackend
    tool?: CustomParamSchema
    positionCenter?: boolean
  }) => {
    return render(
      <TestApi
        customCollection={props?.customCollection ?? customCollection}
        tool={props?.tool ?? tool}
        onHide={props ? mockOnHide : vi.fn()}
        positionCenter={props?.positionCenter}
      />,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    testAPIAvailableMock.mockReset()
  })

  // Tests for basic rendering
  describe('Rendering', () => {
    it('should render without crashing', async () => {
      await act(async () => {
        renderTestApi()
      })

      expect(screen.getByText('tools.test.testResult')).toBeInTheDocument()
    })

    it('should display tool name in the title', async () => {
      await act(async () => {
        renderTestApi()
      })

      expect(screen.getByText(/testOp/)).toBeInTheDocument()
    })

    it('should render parameters table', async () => {
      await act(async () => {
        renderTestApi()
      })

      expect(screen.getByText('tools.test.parameters')).toBeInTheDocument()
      expect(screen.getByText('tools.test.value')).toBeInTheDocument()
      expect(screen.getByText('Limit')).toBeInTheDocument()
    })

    it('should render test result placeholder', async () => {
      await act(async () => {
        renderTestApi()
      })

      expect(screen.getByText('tools.test.testResultPlaceholder')).toBeInTheDocument()
    })

    it('should render with positionCenter prop', async () => {
      await act(async () => {
        renderTestApi({ positionCenter: true })
      })

      expect(screen.getByText('tools.test.testResult')).toBeInTheDocument()
    })
  })

  // Tests for API test execution
  describe('API Test Execution', () => {
    it('should run API test with parameters and show result', async () => {
      testAPIAvailableMock.mockResolvedValueOnce({ result: 'ok' })
      renderTestApi()

      const parameterInput = screen.getAllByRole('textbox')[0]
      fireEvent.change(parameterInput, { target: { value: '5' } })
      fireEvent.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(testAPIAvailableMock).toHaveBeenCalledWith({
          provider_name: customCollection.provider,
          tool_name: tool.operation_id,
          credentials: {
            auth_type: AuthType.none,
          },
          schema_type: customCollection.schema_type,
          schema: customCollection.schema,
          parameters: {
            limit: '5',
          },
        })
        expect(screen.getByText('ok')).toBeInTheDocument()
      })
    })

    it('should display error result when API returns error', async () => {
      testAPIAvailableMock.mockResolvedValueOnce({ error: 'API Error occurred' })
      renderTestApi()

      fireEvent.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(screen.getByText('API Error occurred')).toBeInTheDocument()
      })
    })

    it('should call API when test button is clicked', async () => {
      testAPIAvailableMock.mockResolvedValueOnce({ result: 'test completed' })

      await act(async () => {
        renderTestApi()
      })

      // Click test button
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'tools.test.title' }))
      })

      // API should have been called
      await waitFor(() => {
        expect(testAPIAvailableMock).toHaveBeenCalledTimes(1)
        expect(screen.getByText('test completed')).toBeInTheDocument()
      })
    })

    it('should strip extra credential fields when auth_type is none', async () => {
      const collectionWithExtraFields: CustomCollectionBackend = {
        ...customCollection,
        credentials: {
          auth_type: AuthType.none,
          api_key_header: 'X-Api-Key',
          api_key_header_prefix: AuthHeaderPrefix.bearer,
          api_key_value: 'secret',
        },
      }

      testAPIAvailableMock.mockResolvedValueOnce({ result: 'success' })
      renderTestApi({ customCollection: collectionWithExtraFields })

      fireEvent.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(testAPIAvailableMock).toHaveBeenCalledWith(
          expect.objectContaining({
            credentials: {
              auth_type: AuthType.none,
            },
          }),
        )
      })
    })
  })

  // Tests for credentials modal
  describe('Credentials Modal', () => {
    it('should show auth method display text', async () => {
      await act(async () => {
        renderTestApi()
      })

      // Check that the auth method is displayed
      expect(screen.getByText('tools.createTool.authMethod.types.none')).toBeInTheDocument()
    })

    it('should display current auth type in the button', async () => {
      const collectionWithHeader: CustomCollectionBackend = {
        ...customCollection,
        credentials: {
          auth_type: AuthType.apiKeyHeader,
          api_key_header: 'X-Api-Key',
          api_key_header_prefix: AuthHeaderPrefix.bearer,
          api_key_value: 'token',
        },
      }

      await act(async () => {
        renderTestApi({ customCollection: collectionWithHeader })
      })

      // Check that the auth method display shows the correct type
      expect(screen.getByText('tools.createTool.authMethod.types.api_key_header')).toBeInTheDocument()
    })
  })

  // Tests for multiple parameters
  describe('Multiple Parameters', () => {
    it('should handle multiple parameters', async () => {
      const toolWithMultipleParams: CustomParamSchema = {
        ...tool,
        parameters: [
          {
            name: 'limit',
            label: { en_US: 'Limit', zh_Hans: '限制' },
          } as CustomParamSchema['parameters'][0],
          {
            name: 'offset',
            label: { en_US: 'Offset', zh_Hans: '偏移' },
          } as CustomParamSchema['parameters'][0],
        ],
      }

      testAPIAvailableMock.mockResolvedValueOnce({ result: 'multi-param success' })
      renderTestApi({ tool: toolWithMultipleParams })

      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0], { target: { value: '10' } })
      fireEvent.change(inputs[1], { target: { value: '20' } })

      fireEvent.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(testAPIAvailableMock).toHaveBeenCalledWith(
          expect.objectContaining({
            parameters: {
              limit: '10',
              offset: '20',
            },
          }),
        )
      })
    })

    it('should handle empty parameters', async () => {
      testAPIAvailableMock.mockResolvedValueOnce({ result: 'empty params success' })
      renderTestApi()

      // Don't fill in any parameters
      fireEvent.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(testAPIAvailableMock).toHaveBeenCalledWith(
          expect.objectContaining({
            parameters: {},
          }),
        )
      })
    })
  })

  // Tests for different auth types
  describe('Different Auth Types', () => {
    it('should pass apiKeyHeader credentials to API', async () => {
      const collectionWithHeader: CustomCollectionBackend = {
        ...customCollection,
        credentials: {
          auth_type: AuthType.apiKeyHeader,
          api_key_header: 'Authorization',
          api_key_header_prefix: AuthHeaderPrefix.bearer,
          api_key_value: 'test-token',
        },
      }

      testAPIAvailableMock.mockResolvedValueOnce({ result: 'header auth success' })
      renderTestApi({ customCollection: collectionWithHeader })

      fireEvent.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(testAPIAvailableMock).toHaveBeenCalledWith(
          expect.objectContaining({
            credentials: {
              auth_type: AuthType.apiKeyHeader,
              api_key_header: 'Authorization',
              api_key_header_prefix: AuthHeaderPrefix.bearer,
              api_key_value: 'test-token',
            },
          }),
        )
      })
    })

    it('should pass apiKeyQuery credentials to API', async () => {
      const collectionWithQuery: CustomCollectionBackend = {
        ...customCollection,
        credentials: {
          auth_type: AuthType.apiKeyQuery,
          api_key_query_param: 'api_key',
          api_key_value: 'query-token',
        },
      }

      testAPIAvailableMock.mockResolvedValueOnce({ result: 'query auth success' })
      renderTestApi({ customCollection: collectionWithQuery })

      fireEvent.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(testAPIAvailableMock).toHaveBeenCalledWith(
          expect.objectContaining({
            credentials: {
              auth_type: AuthType.apiKeyQuery,
              api_key_query_param: 'api_key',
              api_key_value: 'query-token',
            },
          }),
        )
      })
    })
  })
})
