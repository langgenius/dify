import type { WebhookTriggerNodeType } from '../types'
import { act } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import { useConfig } from '../use-config'

const mockRequest = vi.hoisted(() => vi.fn())
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: mockRequest } }))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
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

describe('webhook/use-config', () => {
  beforeEach(() => mockRequest.mockReset())
  it('keeps successive edits and removes downstream references when body format changes', () => {
    const payload = createPayload({
      body: [{ name: 'payload', type: VarType.string, required: true }],
      variables: [
        { variable: 'payload', label: 'body', value_selector: [], value_type: VarType.string },
        { variable: 'token', label: 'header', value_selector: [], value_type: VarType.string },
      ],
    })
    const consumer = createNode({
      id: 'consumer',
      data: {
        type: BlockEnum.TemplateTransform,
        variables: [{ variable: 'body', value_selector: ['node', 'payload'] }],
        template: '{{ body }}',
      },
    })
    const { result } = renderNodeConfig(useConfig, payload, {
      nodes: [createNode({ id: 'node', data: payload }), consumer],
      edges: [createEdge({ source: 'node', target: 'consumer' })],
    })
    act(() => result.current.config.handleMethodChange('GET'))
    act(() => result.current.config.handleContentTypeChange('text/plain'))
    act(() => result.current.config.handleAsyncModeChange(true))
    act(() => result.current.config.handleStatusCodeChange(204))
    act(() => result.current.config.handleResponseBodyChange('ok'))
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      method: 'GET',
      content_type: 'text/plain',
      body: [],
      variables: [expect.objectContaining({ variable: 'token', label: 'header' })],
      async_mode: true,
      status_code: 204,
      response_body: 'ok',
    })
    expect(result.current.flow.getNode('consumer')?.data.variables).toEqual([
      { variable: 'body', value_selector: [] },
    ])
  })
  it('merges sources and rejects a name conflicting with the current headers', () => {
    const { result } = renderNodeConfig(useConfig, createPayload())
    act(() =>
      result.current.config.handleParamsChange([
        { name: 'page', type: VarType.number, required: true },
      ]),
    )
    act(() =>
      result.current.config.handleHeadersChange([{ name: 'x-request-id', required: false }]),
    )
    act(() =>
      result.current.config.handleBodyChange([
        { name: 'body_field', type: VarType.string, required: true },
      ]),
    )
    const saved = result.current.flow.getNode('node')?.data
    expect(saved).toMatchObject({
      params: [{ name: 'page', type: VarType.number, required: true }],
      headers: [{ name: 'x-request-id', required: false }],
      body: [{ name: 'body_field', type: VarType.string, required: true }],
      variables: expect.arrayContaining([
        expect.objectContaining({ variable: 'page', label: 'param' }),
        expect.objectContaining({ variable: 'x_request_id', label: 'header' }),
        expect.objectContaining({ variable: 'body_field', label: 'body' }),
      ]),
    })
    act(() =>
      result.current.config.handleParamsChange([
        { name: 'x_request_id', type: VarType.string, required: true },
      ]),
    )
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(result.current.flow.getNode('node')?.data.variables).toEqual(saved.variables)
  })
  it('persists generated URLs and skips the next request', async () => {
    mockRequest.mockResolvedValue({
      webhook_url: 'https://example.com/hook',
      webhook_debug_url: 'https://example.com/debug',
    })
    const { result } = renderNodeConfig(useConfig, createPayload())
    await act(() => result.current.config.generateWebhookUrl())
    expect(mockRequest).toHaveBeenCalledWith(
      ['apps', 'byAppId', 'workflows', 'triggers', 'webhook', 'get'],
      { params: { app_id: 'app-1' }, query: { node_id: 'node' } },
      expect.any(Object),
    )
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      webhook_url: 'https://example.com/hook',
      webhook_debug_url: 'https://example.com/debug',
    })
    await act(() => result.current.config.generateWebhookUrl())
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })
  it('stores an empty URL after a failed generation', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Unavailable'))
    const { result } = renderNodeConfig(useConfig, createPayload())
    await act(() => result.current.config.generateWebhookUrl())
    expect(result.current.flow.getNode('node')?.data.webhook_url).toBe('')
  })
  it('skips URL generation in a readonly snippet', async () => {
    const payload = createPayload()
    const { result } = renderNodeConfig(useConfig, payload, {
      resource: { kind: 'snippet', snippetId: 's' },
      initialStoreState: { canvasReadOnly: true },
    })
    expect(result.current.config.readOnly).toBe(true)
    await act(() => result.current.config.generateWebhookUrl())
    expect(mockRequest).not.toHaveBeenCalled()
    expect(result.current.flow.getNode('node')?.data).toMatchObject(payload)
  })
})
