import type { WebhookTriggerNodeType } from '../types'
import { renderEditorHook as renderHookWithConsoleQuery } from '@/app/components/workflow/editor-resource/__tests__/render'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { createNodeCrudModuleMock } from '../../__tests__/use-config-test-utils'
import { useConfig } from '../use-config'

const mockSetInputs = vi.hoisted(() => vi.fn())
const mockIsVarUsedInNodes = vi.hoisted(() => vi.fn())
const mockRemoveUsedVarInNodes = vi.hoisted(() => vi.fn())
const mockUseNodesReadOnly = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: Record<string, unknown>) => options?.key || key),
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  __esModule: true,
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/use-workflow')>()

  return {
    ...actual,
    useNodesReadOnly: () => mockUseNodesReadOnly(),
    useWorkflow: () => ({
      isVarUsedInNodes: (...args: unknown[]) => mockIsVarUsedInNodes(...args),
      removeUsedVarInNodes: (...args: unknown[]) => mockRemoveUsedVarInNodes(...args),
    }),
  }
})

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  ...createNodeCrudModuleMock<WebhookTriggerNodeType>(mockSetInputs),
}))

const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockRequest },
}))
const mockedToastError = vi.mocked(toast.error)

const createPayload = (
  overrides: Partial<WebhookTriggerNodeType> = {},
): WebhookTriggerNodeType => ({
  title: 'Webhook',
  desc: '',
  type: BlockEnum.TriggerWebhook,
  method: 'POST',
  content_type: 'application/json',
  headers: [],
  params: [],
  body: [],
  async_mode: false,
  status_code: 200,
  response_body: '',
  variables: [],
  ...overrides,
})

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockReset()
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  it('should update simple fields and reset body variables when content type changes', () => {
    const payload = createPayload({
      content_type: 'application/json',
      body: [{ name: 'payload', type: VarType.string, required: true }],
      variables: [
        {
          variable: 'payload',
          label: 'body',
          required: true,
          value_selector: [],
          value_type: VarType.string,
        },
        {
          variable: 'token',
          label: 'header',
          required: false,
          value_selector: [],
          value_type: VarType.string,
        },
      ],
    })
    mockIsVarUsedInNodes.mockImplementation(([_, variable]) => variable === 'payload')
    const { result } = renderHookWithConsoleQuery(() => useConfig('webhook-node', payload))

    result.current.handleMethodChange('GET')
    result.current.handleContentTypeChange('text/plain')
    result.current.handleAsyncModeChange(true)
    result.current.handleStatusCodeChange(204)
    result.current.handleResponseBodyChange('ok')

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
      }),
    )
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        content_type: 'text/plain',
        body: [],
        variables: [
          expect.objectContaining({
            variable: 'token',
            label: 'header',
          }),
        ],
      }),
    )
    expect(mockRemoveUsedVarInNodes).toHaveBeenCalledWith(['webhook-node', 'payload'])
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ async_mode: true }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ status_code: 204 }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ response_body: 'ok' }))
  })

  it('should sync params, headers and body variables and reject conflicting names', () => {
    const payload = createPayload({
      variables: [
        {
          variable: 'existing_header',
          label: 'header',
          required: false,
          value_selector: [],
          value_type: VarType.string,
        },
      ],
    })
    const { result } = renderHookWithConsoleQuery(() => useConfig('webhook-node', payload))

    result.current.handleParamsChange([{ name: 'page', type: VarType.number, required: true }])
    result.current.handleHeadersChange([{ name: 'x-request-id', required: false }])
    result.current.handleBodyChange([{ name: 'body_field', type: VarType.string, required: true }])
    result.current.handleParamsChange([
      { name: 'existing_header', type: VarType.string, required: true },
    ])

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        params: [{ name: 'page', type: VarType.number, required: true }],
        variables: expect.arrayContaining([
          expect.objectContaining({
            variable: 'page',
            label: 'param',
            value_type: VarType.number,
          }),
        ]),
      }),
    )
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: [{ name: 'x-request-id', required: false }],
        variables: expect.arrayContaining([
          expect.objectContaining({
            variable: 'x_request_id',
            label: 'header',
          }),
        ]),
      }),
    )
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        body: [{ name: 'body_field', type: VarType.string, required: true }],
        variables: expect.arrayContaining([
          expect.objectContaining({
            variable: 'body_field',
            label: 'body',
          }),
        ]),
      }),
    )
    expect(mockedToastError).toHaveBeenCalledTimes(1)
  })

  it('should generate webhook urls once and fall back to empty url on request failure', async () => {
    mockRequest.mockResolvedValueOnce({
      webhook_url: 'https://example.com/hook',
      webhook_debug_url: 'https://example.com/debug',
    } as never)
    mockRequest.mockRejectedValueOnce(new Error('boom'))

    const { result, rerender } = renderHookWithConsoleQuery(
      ({ payload }) => useConfig('webhook-node', payload),
      {
        initialProps: {
          payload: createPayload(),
        },
      },
    )

    await result.current.generateWebhookUrl()
    expect(mockRequest).toHaveBeenCalledWith(
      ['apps', 'byAppId', 'workflows', 'triggers', 'webhook', 'get'],
      { params: { app_id: 'app-1' }, query: { node_id: 'webhook-node' } },
      expect.any(Object),
    )
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook_url: 'https://example.com/hook',
        webhook_debug_url: 'https://example.com/debug',
      }),
    )

    rerender({
      payload: createPayload(),
    })
    await result.current.generateWebhookUrl()
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook_url: '',
      }),
    )

    rerender({
      payload: createPayload({ webhook_url: 'https://already-exists' }),
    })
    await result.current.generateWebhookUrl()
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })

  it('should expose readonly state and skip url generation in a snippet', async () => {
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true })

    const { result } = renderHookWithConsoleQuery(
      () => useConfig('webhook-node', createPayload()),
      {
        resource: { kind: 'snippet', snippetId: 'snippet-1' },
      },
    )

    expect(result.current.readOnly).toBe(true)

    await result.current.generateWebhookUrl()

    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockSetInputs).not.toHaveBeenCalled()
  })
})
