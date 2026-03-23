import { renderHook } from '@testing-library/react'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { BlockEnum } from '../../types'
import { useAutoGenerateWebhookUrl } from '../use-auto-generate-webhook-url'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('@/app/components/app/store', async () =>
  (await import('../../__tests__/service-mock-factory')).createAppStoreMock({ appId: 'app-123' }))

const mockFetchWebhookUrl = vi.fn()
vi.mock('@/service/apps', () => ({
  fetchWebhookUrl: (...args: unknown[]) => mockFetchWebhookUrl(...args),
}))

describe('useAutoGenerateWebhookUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'webhook-1', position: { x: 0, y: 0 }, data: { type: BlockEnum.TriggerWebhook, webhook_url: '' } },
      { id: 'code-1', position: { x: 300, y: 0 }, data: { type: BlockEnum.Code } },
    ]
  })

  it('should fetch and set webhook URL for a webhook trigger node', async () => {
    mockFetchWebhookUrl.mockResolvedValue({
      webhook_url: 'https://example.com/webhook',
      webhook_debug_url: 'https://example.com/webhook-debug',
    })

    const { result } = renderHook(() => useAutoGenerateWebhookUrl())
    await result.current('webhook-1')

    expect(mockFetchWebhookUrl).toHaveBeenCalledWith({ appId: 'app-123', nodeId: 'webhook-1' })
    expect(rfState.setNodes).toHaveBeenCalledOnce()

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    const webhookNode = updatedNodes.find((n: { id: string }) => n.id === 'webhook-1')
    expect(webhookNode.data.webhook_url).toBe('https://example.com/webhook')
    expect(webhookNode.data.webhook_debug_url).toBe('https://example.com/webhook-debug')
  })

  it('should not fetch when node is not a webhook trigger', async () => {
    const { result } = renderHook(() => useAutoGenerateWebhookUrl())
    await result.current('code-1')

    expect(mockFetchWebhookUrl).not.toHaveBeenCalled()
    expect(rfState.setNodes).not.toHaveBeenCalled()
  })

  it('should not fetch when node does not exist', async () => {
    const { result } = renderHook(() => useAutoGenerateWebhookUrl())
    await result.current('nonexistent')

    expect(mockFetchWebhookUrl).not.toHaveBeenCalled()
  })

  it('should not fetch when webhook_url already exists', async () => {
    rfState.nodes[0].data.webhook_url = 'https://existing.com/webhook'

    const { result } = renderHook(() => useAutoGenerateWebhookUrl())
    await result.current('webhook-1')

    expect(mockFetchWebhookUrl).not.toHaveBeenCalled()
  })

  it('should handle API errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchWebhookUrl.mockRejectedValue(new Error('network error'))

    const { result } = renderHook(() => useAutoGenerateWebhookUrl())
    await result.current('webhook-1')

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to auto-generate webhook URL:',
      expect.any(Error),
    )
    expect(rfState.setNodes).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
