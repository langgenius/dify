import type { EditorIdentity } from '../../editor-resource/state'
import type { Node } from '../../types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { useNodes } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import {
  renderWorkflowFlowComponent,
  renderWorkflowFlowHook,
} from '../../__tests__/workflow-test-env'
import { EditorResourceScope } from '../../editor-resource/provider'
import { BlockEnum } from '../../types'
import { useAutoGenerateWebhookUrl } from '../use-auto-generate-webhook-url'

type WebhookFlowNode = Node & {
  data: NonNullable<Node['data']> & {
    webhook_url?: string
    webhook_debug_url?: string
  }
}

const mockRequest = vi.hoisted(() => vi.fn())

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
        resource: { kind: 'app', appId: 'app-123', mode: 'workflow' },
        nodes: createFlowNodes(),
        edges: [],
      },
    )

  beforeEach(() => {
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

  it('uses the scoped app after switching resources and skips snippets', async () => {
    const user = userEvent.setup()
    function GenerateButton() {
      const generate = useAutoGenerateWebhookUrl()
      return createElement(
        'button',
        { type: 'button', onClick: () => generate('webhook-1') },
        'Generate URL',
      )
    }
    const view = (identity: EditorIdentity) =>
      createElement(EditorResourceScope, { identity, children: createElement(GenerateButton) })
    const { rerender } = renderWorkflowFlowComponent(
      view({ kind: 'snippet', snippetId: 'snippet-1' }),
      {
        nodes: createFlowNodes(),
        edges: [],
      },
    )
    await user.click(screen.getByRole('button', { name: 'Generate URL' }))
    expect(mockRequest).not.toHaveBeenCalled()

    mockRequest.mockResolvedValue({
      webhook_url: 'https://example.com/other-webhook',
      webhook_debug_url: 'https://example.com/other-debug',
    })
    rerender(view({ kind: 'app', appId: 'app-456' }))
    await user.click(screen.getByRole('button', { name: 'Generate URL' }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        ['apps', 'byAppId', 'workflows', 'triggers', 'webhook', 'get'],
        { params: { app_id: 'app-456' }, query: { node_id: 'webhook-1' } },
        expect.any(Object),
      ),
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
