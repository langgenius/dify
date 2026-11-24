import type { CustomCollectionBackend, CustomParamSchema } from '@/app/components/tools/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AuthHeaderPrefix, AuthType } from '@/app/components/tools/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import TestApi from '../test-api'

const previewMock = vi.hoisted(() =>
  vi.fn<
    typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.test.pre.post
  >(),
)

// boundary: generated preview transport responses; form and mutation behavior remain real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProvider.api.test.pre.post': previewMock,
    }),
  }
})

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
    labels: [],
  }

  const tool: CustomParamSchema = {
    operation_id: 'testOp',
    summary: 'summary',
    method: 'GET',
    server_url: 'https://api.example.com',
    parameters: [
      {
        name: 'limit',
        label: {
          en_US: 'Limit',
          zh_Hans: '限制',
        },
      } as CustomParamSchema['parameters'][0],
    ],
  }

  const mockOnHide = vi.fn()

  const renderTestApi = (props?: {
    customCollection?: CustomCollectionBackend
    tool?: CustomParamSchema
    positionCenter?: boolean
  }) => {
    return renderWithConsoleQuery(
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
    previewMock.mockReset()
  })

  // Tests for basic rendering

  // Tests for API test execution
  describe('API Test Execution', () => {
    it('should run API test with parameters and show result', async () => {
      const user = userEvent.setup()
      previewMock.mockResolvedValueOnce({ result: 'ok' })
      renderTestApi()

      const parameterInput = screen.getAllByRole('textbox')[0]
      await user.type(parameterInput!, '5')
      await user.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(previewMock).toHaveBeenCalledWith({
          body: {
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
          },
        })
        expect(screen.getByRole('status')).toHaveTextContent('ok')
      })
    })

    it('should display error result when API returns error', async () => {
      const user = userEvent.setup()
      previewMock.mockResolvedValueOnce({ error: 'API Error occurred' })
      renderTestApi()

      await user.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent('API Error occurred')
      })
    })

    it('should strip extra credential fields when auth_type is none', async () => {
      const user = userEvent.setup()
      const collectionWithExtraFields: CustomCollectionBackend = {
        ...customCollection,
        credentials: {
          auth_type: AuthType.none,
          api_key_header: 'X-Api-Key',
          api_key_header_prefix: AuthHeaderPrefix.bearer,
          api_key_value: 'secret',
        },
      }

      previewMock.mockResolvedValueOnce({ result: 'success' })
      renderTestApi({ customCollection: collectionWithExtraFields })

      await user.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(previewMock).toHaveBeenCalledWith({
          body: expect.objectContaining({
            credentials: {
              auth_type: AuthType.none,
            },
          }),
        })
      })
    })
  })

  // Tests for credentials modal

  // Tests for multiple parameters
  describe('Multiple Parameters', () => {
    it('should handle multiple parameters', async () => {
      const user = userEvent.setup()
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

      previewMock.mockResolvedValueOnce({ result: 'multi-param success' })
      renderTestApi({ tool: toolWithMultipleParams })

      const inputs = screen.getAllByRole('textbox')
      await user.type(inputs[0]!, '10')
      await user.type(inputs[1]!, '20')

      await user.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(previewMock).toHaveBeenCalledWith({
          body: expect.objectContaining({
            parameters: {
              limit: '10',
              offset: '20',
            },
          }),
        })
      })
    })

    it('should handle empty parameters', async () => {
      const user = userEvent.setup()
      previewMock.mockResolvedValueOnce({ result: 'empty params success' })
      renderTestApi()

      // Don't fill in any parameters
      await user.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(previewMock).toHaveBeenCalledWith({
          body: expect.objectContaining({
            parameters: {},
          }),
        })
      })
    })
  })

  // Tests for different auth types
  describe('Different Auth Types', () => {
    it('should pass apiKeyHeader credentials to API', async () => {
      const user = userEvent.setup()
      const collectionWithHeader: CustomCollectionBackend = {
        ...customCollection,
        credentials: {
          auth_type: AuthType.apiKeyHeader,
          api_key_header: 'Authorization',
          api_key_header_prefix: AuthHeaderPrefix.bearer,
          api_key_value: 'test-token',
        },
      }

      previewMock.mockResolvedValueOnce({ result: 'header auth success' })
      renderTestApi({ customCollection: collectionWithHeader })

      await user.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(previewMock).toHaveBeenCalledWith({
          body: expect.objectContaining({
            credentials: {
              auth_type: AuthType.apiKeyHeader,
              api_key_header: 'Authorization',
              api_key_header_prefix: AuthHeaderPrefix.bearer,
              api_key_value: 'test-token',
            },
          }),
        })
      })
    })

    it('should pass apiKeyQuery credentials to API', async () => {
      const user = userEvent.setup()
      const collectionWithQuery: CustomCollectionBackend = {
        ...customCollection,
        credentials: {
          auth_type: AuthType.apiKeyQuery,
          api_key_query_param: 'api_key',
          api_key_value: 'query-token',
        },
      }

      previewMock.mockResolvedValueOnce({ result: 'query auth success' })
      renderTestApi({ customCollection: collectionWithQuery })

      await user.click(screen.getByRole('button', { name: 'tools.test.title' }))

      await waitFor(() => {
        expect(previewMock).toHaveBeenCalledWith({
          body: expect.objectContaining({
            credentials: {
              auth_type: AuthType.apiKeyQuery,
              api_key_query_param: 'api_key',
              api_key_value: 'query-token',
            },
          }),
        })
      })
    })
  })
})
