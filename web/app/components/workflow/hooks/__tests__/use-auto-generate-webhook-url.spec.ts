import type { Node } from '../../types'
import { act, waitFor } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useAutoGenerateWebhookUrl } from '../use-auto-generate-webhook-url'

type WebhookFlowNode = Node & {
  data: NonNullable<Node['data']> & {
    webhook_url?: string
    webhook_debug_url?: string
  }
}

const routeParams = vi.hoisted(() => ({ appId: 'app-123' as string | undefined }))
const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => routeParams,
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockRequest },
}))

describe('useAutoGenerateWebhookUrl', () => {
  const createFlowNodes = (): WebhookFlowNode[] => [
    createNode({
      id: 'webhook-1',
      data: { type: BlockEnum.TriggerWebhook, webhook_url: '' },
    }) as WebhookFlowNode,
    createNode({
      id: 'code-1',
      position: { x: 300, y: 0 },
      data: { type: BlockEnum.Code },
    }) as WebhookFlowNode,
  ]

  const renderAutoGenerateWebhookUrlHook = () =>
    renderWorkflowFlowHook(
      () => ({
        autoGenerateWebhookUrl: useAutoGenerateWebhookUrl(),
        nodes: useNodes<WebhookFlowNode>(),
      }),
      {
        nodes: createFlowNodes(),
        edges: [],
      },
    )

  beforeEach(() => {
    routeParams.appId = 'app-123'
    mockRequest.mockReset()
  })

  it('should fetch and set webhook URL for a webhook trigger node', async () => {
    mockRequest.mockResolvedValue({
      webhook_url: 'https://example.com/webhook',
      webhook_debug_url: 'https://example.com/webhook-debug',
    })

    const { result } = renderAutoGenerateWebhookUrlHook()

    await act(async () => {
      await result.current.autoGenerateWebhookUrl('webhook-1')
    })

    expect(mockRequest).toHaveBeenCalledWith(
      ['apps', 'byAppId', 'workflows', 'triggers', 'webhook', 'get'],
      { params: { app_id: 'app-123' }, query: { node_id: 'webhook-1' } },
      expect.any(Object),
    )

    await waitFor(() => {
      const webhookNode = result.current.nodes.find((node) => node.id === 'webhook-1') as
        | WebhookFlowNode
        | undefined
      expect(webhookNode?.data.webhook_url).toBe('https://example.com/webhook')
      expect(webhookNode?.data.webhook_debug_url).toBe('https://example.com/webhook-debug')
    })
  })

  it('uses the current route after switching apps and skips routes without an app', async () => {
    routeParams.appId = undefined
    const { result, rerender } = renderAutoGenerateWebhookUrlHook()

    await act(async () => {
      await result.current.autoGenerateWebhookUrl('webhook-1')
    })
    expect(mockRequest).not.toHaveBeenCalled()

    routeParams.appId = 'app-456'
    rerender()
    mockRequest.mockResolvedValue({
      webhook_url: 'https://example.com/other-webhook',
      webhook_debug_url: 'https://example.com/other-debug',
    })
    await act(async () => {
      await result.current.autoGenerateWebhookUrl('webhook-1')
    })

    expect(mockRequest).toHaveBeenCalledWith(
      ['apps', 'byAppId', 'workflows', 'triggers', 'webhook', 'get'],
      { params: { app_id: 'app-456' }, query: { node_id: 'webhook-1' } },
      expect.any(Object),
    )
  })

  it('should not fetch when node is not a webhook trigger', async () => {
    const { result } = renderAutoGenerateWebhookUrlHook()

    await act(async () => {
      await result.current.autoGenerateWebhookUrl('code-1')
    })

    expect(mockRequest).not.toHaveBeenCalled()

    const codeNode = result.current.nodes.find((node) => node.id === 'code-1') as
      | WebhookFlowNode
      | undefined
    expect(codeNode?.data.webhook_url).toBeUndefined()
  })

  it('should not fetch when node does not exist', async () => {
    const { result } = renderAutoGenerateWebhookUrlHook()

    await act(async () => {
      await result.current.autoGenerateWebhookUrl('nonexistent')
    })

    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('should not fetch when webhook_url already exists', async () => {
    const { result } = renderWorkflowFlowHook(
      () => ({
        autoGenerateWebhookUrl: useAutoGenerateWebhookUrl(),
      }),
      {
        nodes: [
          createNode({
            id: 'webhook-1',
            data: {
              type: BlockEnum.TriggerWebhook,
              webhook_url: 'https://existing.com/webhook',
            },
          }) as WebhookFlowNode,
        ],
        edges: [],
      },
    )

    await act(async () => {
      await result.current.autoGenerateWebhookUrl('webhook-1')
    })

    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('should handle API errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRequest.mockRejectedValue(new Error('network error'))

    const { result } = renderAutoGenerateWebhookUrlHook()

    await act(async () => {
      await result.current.autoGenerateWebhookUrl('webhook-1')
    })

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to auto-generate webhook URL:',
      expect.any(Error),
    )
    const webhookNode = result.current.nodes.find((node) => node.id === 'webhook-1') as
      | WebhookFlowNode
      | undefined
    expect(webhookNode?.data.webhook_url).toBe('')
    consoleSpy.mockRestore()
  })
})
