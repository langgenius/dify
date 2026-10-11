import type { Mock } from 'vite-plus/test'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createZendeskRuntime } from '../runtime'

describe('Zendesk runtime', () => {
  let api: Mock
  let runtime: ReturnType<typeof createZendeskRuntime>

  beforeEach(() => {
    api = vi.fn()
    runtime = createZendeskRuntime(() => api)
  })

  it('queues fields and opens only after the single requested load is ready', async () => {
    const fieldsCallback = vi.fn()
    runtime.setConversationFields(
      [{ id: 'email', value: 'user@example.com' }],
      'CLOUD',
      fieldsCallback,
    )

    const firstOpen = runtime.open('CLOUD')
    const secondOpen = runtime.open('CLOUD')

    expect(firstOpen).toBe(secondOpen)
    expect(runtime.getSnapshot()).toEqual({ attempt: 1, status: 'loading' })
    expect(api).not.toHaveBeenCalled()

    runtime.markReady()
    await firstOpen

    expect(api).toHaveBeenCalledWith(
      'messenger:set',
      'conversationFields',
      [{ id: 'email', value: 'user@example.com' }],
      expect.any(Function),
    )
    const flushedFieldsCallback = api.mock.calls[0]![3] as () => void
    flushedFieldsCallback()
    expect(fieldsCallback).toHaveBeenCalledOnce()
    expect(api).toHaveBeenNthCalledWith(2, 'messenger', 'show')
    expect(api).toHaveBeenNthCalledWith(3, 'messenger', 'open')
    expect(runtime.getSnapshot()).toEqual({ attempt: 1, status: 'ready' })
  })

  it('flushes only the latest pending value for each field', async () => {
    runtime.setConversationFields(
      [
        { id: 'email', value: 'old@example.com' },
        { id: 'workspace', value: 'workspace-1' },
      ],
      'CLOUD',
    )
    runtime.setConversationFields(
      [
        { id: 'email', value: 'new@example.com' },
        { id: 'plan', value: 'professional-plan' },
      ],
      'CLOUD',
    )

    const openPromise = runtime.open('CLOUD')
    runtime.markReady()
    await openPromise

    expect(api).toHaveBeenNthCalledWith(
      1,
      'messenger:set',
      'conversationFields',
      [
        { id: 'email', value: 'new@example.com' },
        { id: 'workspace', value: 'workspace-1' },
        { id: 'plan', value: 'professional-plan' },
      ],
      undefined,
    )
    expect(api).toHaveBeenCalledTimes(3)
  })

  it('can retry a failed load and report the original failure', async () => {
    const failedOpen = runtime.open('CLOUD')
    runtime.markFailed()

    await expect(failedOpen).rejects.toThrow('Failed to load Zendesk')
    expect(runtime.getSnapshot()).toEqual({ attempt: 1, status: 'error' })

    const retriedOpen = runtime.open('CLOUD')
    expect(runtime.getSnapshot()).toEqual({ attempt: 2, status: 'loading' })

    runtime.markReady()
    await retriedOpen

    expect(api).toHaveBeenCalledWith('messenger', 'show')
    expect(api).toHaveBeenCalledWith('messenger', 'open')
  })

  it('does not load or queue fields outside Cloud deployments', async () => {
    runtime.setConversationFields([{ id: 'plan', value: 'sandbox-plan' }], 'COMMUNITY')
    await runtime.open('COMMUNITY')

    expect(runtime.getSnapshot()).toEqual({ attempt: 0, status: 'idle' })
    expect(api).not.toHaveBeenCalled()
  })
})
