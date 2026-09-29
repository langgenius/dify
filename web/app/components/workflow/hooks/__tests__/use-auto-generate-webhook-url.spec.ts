import type { Node } from '../../types'
import { act, waitFor } from '@testing-library/react'
import { useNodes, useStoreApi } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { collaborationManager } from '../../collaboration/core/collaboration-manager'
import { BlockEnum } from '../../types'
import { useAutoGenerateWebhookUrl } from '../use-auto-generate-webhook-url'

type WebhookFlowNode = Node & {
  data: NonNullable<Node['data']> & {
    webhook_url?: string
    webhook_debug_url?: string
  }
}

const mockFetchWebhookUrl = vi.fn()
vi.mock('@/service/apps', () => ({
  fetchWebhookUrl: (...args: unknown[]) => mockFetchWebhookUrl(...args),
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

  const renderAutoGenerateWebhookUrlHook = (appId = 'app-123') =>
    renderWorkflowFlowHook(
      () => ({
        autoGenerateWebhookUrl: useAutoGenerateWebhookUrl(),
        store: useStoreApi(),
        nodes: useNodes<WebhookFlowNode['data']>(),
      }),
      {
        initialStoreState: { appId },
        nodes: createFlowNodes(),
        edges: [],
      },
    )

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch and set webhook URL for a webhook trigger node', async () => {
    mockFetchWebhookUrl.mockResolvedValue({
      webhook_url: 'https://example.com/webhook',
      webhook_debug_url: 'https://example.com/webhook-debug',
    })

    const { result } = renderAutoGenerateWebhookUrlHook()

    await act(async () => {
      await result.current.autoGenerateWebhookUrl('webhook-1')
    })

    expect(mockFetchWebhookUrl).toHaveBeenCalledWith({ appId: 'app-123', nodeId: 'webhook-1' })

    await waitFor(() => {
      const webhookNode = result.current.nodes.find((node) => node.id === 'webhook-1') as
        | WebhookFlowNode
        | undefined
      expect(webhookNode?.data.webhook_url).toBe('https://example.com/webhook')
      expect(webhookNode?.data.webhook_debug_url).toBe('https://example.com/webhook-debug')
    })
  })

  it.each(['app-b', 'app-a'])(
    'does not broadcast an old webhook into the new %s canvas instance',
    async (nextAppId) => {
      let resolveWebhook!: (response: { webhook_url: string; webhook_debug_url: string }) => void
      mockFetchWebhookUrl.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveWebhook = resolve
        }),
      )
      const broadcastNodes = vi.spyOn(collaborationManager, 'setNodes')
      const first = renderAutoGenerateWebhookUrlHook('app-a')
      const pendingWebhook = first.result.current.autoGenerateWebhookUrl('webhook-1')
      expect(mockFetchWebhookUrl).toHaveBeenCalledWith({ appId: 'app-a', nodeId: 'webhook-1' })
      first.unmount()
      const second = renderAutoGenerateWebhookUrlHook(nextAppId)
      const ownsStore = vi
        .spyOn(collaborationManager, 'ownsReactFlowStore')
        .mockImplementation((store) => store === second.result.current.store)

      await act(async () => {
        resolveWebhook({
          webhook_url: 'https://app-a/webhook',
          webhook_debug_url: 'https://app-a/debug',
        })
        await pendingWebhook
      })

      expect(broadcastNodes).not.toHaveBeenCalled()
      expect(
        second.result.current.nodes.find((node) => node.id === 'webhook-1')?.data.webhook_url,
      ).toBe('')
      ownsStore.mockRestore()
      broadcastNodes.mockRestore()
    },
  )

  it('should not fetch when node is not a webhook trigger', async () => {
    const { result } = renderAutoGenerateWebhookUrlHook()

    await act(async () => {
      await result.current.autoGenerateWebhookUrl('code-1')
    })

    expect(mockFetchWebhookUrl).not.toHaveBeenCalled()

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

    expect(mockFetchWebhookUrl).not.toHaveBeenCalled()
  })

  it('should not fetch when webhook_url already exists', async () => {
    const { result } = renderWorkflowFlowHook(
      () => ({
        autoGenerateWebhookUrl: useAutoGenerateWebhookUrl(),
      }),
      {
        initialStoreState: { appId: 'app-123' },
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

    expect(mockFetchWebhookUrl).not.toHaveBeenCalled()
  })

  it('should handle API errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchWebhookUrl.mockRejectedValue(new Error('network error'))

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
