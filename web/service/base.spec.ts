import { toast } from '@langgenius/dify-ui/toast'
import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
// oxlint-disable-next-line no-restricted-imports
import { del, get, handleSseResponse, patch, post, put, sseGet, ssePost } from './base'

const refreshAccessTokenOrReLoginMock = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('./refresh-token', () => ({
  refreshAccessTokenOrReLogin: refreshAccessTokenOrReLoginMock,
}))

describe('ssePost and sseGet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('should report fetch failures through onError without throwing from the catch handler', async () => {
    const onError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Network failed'))

    await ssePost(
      '/chat-messages',
      {
        body: {
          query: 'hello',
        },
      },
      {
        onError,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('TypeError: Network failed')
    })
    expect(toast.error).toHaveBeenCalledWith('TypeError: Network failed')
  })

  it('should report token refresh failures through onError', async () => {
    const onError = vi.fn()
    refreshAccessTokenOrReLoginMock.mockRejectedValueOnce(new Error('refresh failed'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 401 }))

    await ssePost(
      '/chat-messages',
      {
        body: {
          query: 'hello',
        },
      },
      {
        onError,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Error: refresh failed')
    })
  })

  it('should report event stream token refresh failures through onError', async () => {
    const onError = vi.fn()
    refreshAccessTokenOrReLoginMock.mockRejectedValueOnce(new Error('resume refresh failed'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 401 }))

    await sseGet(
      '/workflow/workflow-run-1/events',
      {},
      {
        onError,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Error: resume refresh failed')
    })
  })

  it('should report stream reader failures through onError and onCompleted', async () => {
    const onError = vi.fn()
    const onCompleted = vi.fn()
    const mockReader = {
      read: vi.fn().mockRejectedValueOnce(new Error('stream lost')),
    }
    const response = {
      status: 200,
      ok: true,
      body: {
        getReader: () => mockReader,
      },
    } as unknown as Response

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    await ssePost(
      '/chat-messages',
      {
        body: {
          query: 'hello',
        },
      },
      {
        onError,
        onCompleted,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Error: stream lost', 'stream_read_error')
    })
    expect(onCompleted).toHaveBeenCalledWith(true, 'Error: stream lost')
    expect(toast.error).toHaveBeenCalledWith('Error: stream lost')
  })

  it('should cancel the stream reader after an application error event', async () => {
    const onError = vi.fn()
    const onCompleted = vi.fn()
    const reader = {
      read: vi.fn().mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(
          ['data: {"event":"error","message":"run failed","code":"run_failed"}', '', ''].join('\n'),
        ),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response)

    await ssePost('/apps/app-1/workflows/draft/run', {}, { onError, onCompleted })

    expect(reader.cancel).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('run failed', 'run_failed')
    expect(onCompleted).toHaveBeenCalledWith(true, 'run failed')
  })

  it('should not notify when the stream reader is aborted', async () => {
    const onError = vi.fn()
    const onCompleted = vi.fn()
    const mockReader = {
      read: vi
        .fn()
        .mockRejectedValueOnce(new DOMException('BodyStreamBuffer was aborted', 'AbortError')),
    }
    const response = {
      status: 200,
      ok: true,
      body: {
        getReader: () => mockReader,
      },
    } as unknown as Response

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    await ssePost(
      '/chat-messages',
      {
        body: {
          query: 'hello',
        },
      },
      {
        onError,
        onCompleted,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        'AbortError: BodyStreamBuffer was aborted',
        'stream_read_error',
      )
    })
    expect(onCompleted).toHaveBeenCalledWith(true, 'AbortError: BodyStreamBuffer was aborted')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should quietly stop reconnect handling when the caller aborts the request', async () => {
    const onError = vi.fn()
    const onCompleted = vi.fn()
    let controller: AbortController | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted', 'AbortError')),
            { once: true },
          )
        }),
    )

    const request = ssePost(
      '/apps/app-1/workflows/draft/run',
      {},
      {
        getAbortController: (value) => {
          controller = value
        },
        onError,
        onCompleted,
      },
    )
    controller!.abort()
    await request

    expect(onError).not.toHaveBeenCalled()
    expect(onCompleted).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should resume from the last SSE cursor without appending a duplicated chunk', async () => {
    const onData = vi.fn()
    const onWorkflowFinished = vi.fn()
    const onCompleted = vi.fn()
    const firstReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 1-0',
              'data: {"event":"workflow_started","workflow_run_id":"run-1","data":{"id":"run-1"}}',
              '',
              'id: 2-0',
              'data: {"event":"message","workflow_run_id":"run-1","id":"message-1","answer":"Hel"}',
              '',
              '',
            ].join('\n'),
          ),
        })
        .mockRejectedValueOnce(new Error('connection reset')),
    }
    const resumedReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 2-0',
              'data: {"event":"message","workflow_run_id":"run-1","id":"message-1","answer":"Hel"}',
              '',
              'id: 3-0',
              'data: {"event":"message","workflow_run_id":"run-1","id":"message-1","answer":"lo"}',
              '',
              'id: 4-0',
              'data: {"event":"message_end","workflow_run_id":"run-1","id":"message-1"}',
              '',
              'id: 5-0',
              'data: {"event":"workflow_finished","workflow_run_id":"run-1","data":{"id":"run-1"}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers({ 'X-Workflow-Run-ID': 'run-1' }),
        body: { getReader: () => firstReader },
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => resumedReader },
      } as unknown as Response)

    await ssePost(
      '/apps/app-1/chat-messages',
      { body: { query: 'hello' } },
      {
        onData,
        onWorkflowFinished,
        onCompleted,
        workflowStreamReconnect: { initialDelayMs: 0 },
      },
    )

    expect(onData.mock.calls.map(([chunk]) => chunk)).toEqual(['Hel', 'lo'])
    expect(onWorkflowFinished).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [resumeUrl, resumeOptions] = fetchMock.mock.calls[1]!
    expect(String(resumeUrl)).toContain(
      '/workflow/run-1/events?include_state_snapshot=true&cursor=2-0',
    )
    expect(new Headers(resumeOptions?.headers).get('Last-Event-ID')).toBe('2-0')
  })

  it('should ignore duplicate lifecycle terminal events with different SSE ids', async () => {
    const onWorkflowFinished = vi.fn()
    const onCompleted = vi.fn()
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 10-0',
              'data: {"event":"workflow_started","workflow_run_id":"run-terminal","data":{"id":"run-terminal"}}',
              '',
              'id: 11-0',
              'data: {"event":"workflow_finished","workflow_run_id":"run-terminal","data":{"id":"run-terminal"}}',
              '',
              'id: 12-0',
              'data: {"event":"workflow_finished","workflow_run_id":"run-terminal","data":{"id":"run-terminal"}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response)

    await ssePost('/apps/app-1/workflows/draft/run', {}, { onWorkflowFinished, onCompleted })

    expect(onWorkflowFinished).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it('should bound lifecycle deduplication while retaining recent event keys', async () => {
    const lifecycleEventLimit = 4096
    const onTextReplace = vi.fn()
    const frames = Array.from({ length: lifecycleEventLimit + 1 }, (_, index) => [
      `data: ${JSON.stringify({
        event: 'text_replace',
        workflow_run_id: 'run-lifecycle-limit',
        data: { text: `text-${index}` },
      })}`,
      '',
    ]).flat()
    frames.push(
      `data: ${JSON.stringify({
        event: 'text_replace',
        workflow_run_id: 'run-lifecycle-limit',
        data: { text: `text-${lifecycleEventLimit}` },
      })}`,
      '',
      `data: ${JSON.stringify({
        event: 'text_replace',
        workflow_run_id: 'run-lifecycle-limit',
        data: { text: 'text-0' },
      })}`,
      '',
      'data: {"event":"workflow_finished","workflow_run_id":"run-lifecycle-limit","data":{"id":"run-lifecycle-limit"}}',
      '',
      '',
    )
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(frames.join('\n')),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response)

    await ssePost('/apps/app-1/workflows/draft/run', {}, { onTextReplace })

    const replacedTexts = onTextReplace.mock.calls.map(([event]) => event.data.text)
    expect(replacedTexts).toHaveLength(lifecycleEventLimit + 2)
    expect(replacedTexts.filter((text) => text === 'text-0')).toHaveLength(2)
    expect(replacedTexts.filter((text) => text === `text-${lifecycleEventLimit}`)).toHaveLength(1)
  })

  it('should hide maintenance handoff events and reconnect immediately', async () => {
    const onUnhandledEvent = vi.fn()
    const onWorkflowFinished = vi.fn()
    const firstReader = {
      read: vi.fn().mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(
          [
            'id: 20-0',
            'data: {"event":"workflow_maintenance_paused","workflow_run_id":"run-maintenance"}',
            '',
            '',
          ].join('\n'),
        ),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    }
    const resumedReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 21-0',
              'data: {"event":"workflow_finished","workflow_run_id":"run-maintenance","data":{"id":"run-maintenance"}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers({ 'X-Workflow-Run-ID': 'run-maintenance' }),
        body: { getReader: () => firstReader },
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => resumedReader },
      } as unknown as Response)

    await ssePost('/apps/app-1/workflows/draft/run', {}, { onUnhandledEvent, onWorkflowFinished })

    expect(onUnhandledEvent).not.toHaveBeenCalled()
    expect(onWorkflowFinished).toHaveBeenCalledTimes(1)
    expect(firstReader.cancel).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should share the cursor with a human-input continuation without opening a second reconnect', async () => {
    const onCompleted = vi.fn()
    const onWorkflowPaused = vi.fn()
    const onHumanInputFormFilled = vi.fn()
    const onWorkflowFinished = vi.fn()
    const pausedReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 30-0',
              'data: {"event":"workflow_started","workflow_run_id":"run-paused","data":{"id":"run-paused"}}',
              '',
              'id: 31-0',
              'data: {"event":"workflow_paused","workflow_run_id":"run-paused","data":{"workflow_run_id":"run-paused"}}',
              '',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const continuedReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 32-0',
              'data: {"event":"workflow_paused","workflow_run_id":"run-paused","data":{"workflow_run_id":"run-paused","paused_nodes":["human-2"]}}',
              '',
              'id: 33-0',
              'data: {"event":"human_input_form_filled","workflow_run_id":"run-paused","data":{"form_id":"form-2","node_id":"human-2"}}',
              '',
              'id: 34-0',
              'data: {"event":"workflow_finished","workflow_run_id":"run-paused","data":{"id":"run-paused"}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => pausedReader },
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => continuedReader },
      } as unknown as Response)
    const continuations: Promise<void>[] = []
    const callbacks: Parameters<typeof ssePost>[2] = {
      onCompleted,
      onHumanInputFormFilled,
      onWorkflowFinished,
      onWorkflowPaused: (event) => {
        onWorkflowPaused(event)
        continuations.push(sseGet('/workflow/run-paused/events', {}, callbacks))
      },
    }

    await ssePost('/apps/app-1/workflows/draft/run', {}, callbacks)
    await continuations[0]

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [resumeUrl, resumeOptions] = fetchMock.mock.calls[1]!
    expect(String(resumeUrl)).toContain('cursor=31-0')
    expect(String(resumeUrl)).toContain('continue_on_pause=true')
    expect(new Headers(resumeOptions?.headers).get('Last-Event-ID')).toBe('31-0')
    expect(onWorkflowPaused).toHaveBeenCalledTimes(2)
    expect(onHumanInputFormFilled).toHaveBeenCalledTimes(1)
    expect(onWorkflowFinished).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it('should discard a paused session when no synchronous continuation is created', async () => {
    const pausedReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 35-0',
              'data: {"event":"workflow_paused","workflow_run_id":"run-late-resume","data":{"workflow_run_id":"run-late-resume"}}',
              '',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const finishedReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'data: {"event":"workflow_finished","workflow_run_id":"run-late-resume","data":{"id":"run-late-resume"}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => pausedReader },
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => finishedReader },
      } as unknown as Response)

    await ssePost('/apps/app-1/workflows/draft/run', {}, {})
    await sseGet('/workflow/run-late-resume/events', {}, {})

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const lateResumeUrl = String(fetchMock.mock.calls[1]![0])
    expect(lateResumeUrl).toContain('include_state_snapshot=true')
    expect(lateResumeUrl).not.toContain('continue_on_pause=true')
    expect(lateResumeUrl).not.toContain('cursor=35-0')
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Last-Event-ID')).toBeNull()
  })

  it('should retry a transient 404 after an accepted workflow response header', async () => {
    const initialReader = {
      read: vi.fn().mockRejectedValueOnce(new Error('rolling update closed the stream')),
    }
    const finishedReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 41-0',
              'data: {"event":"workflow_finished","workflow_run_id":"run-accepted","data":{"id":"run-accepted"}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers({ 'X-Workflow-Run-ID': 'run-accepted' }),
        body: { getReader: () => initialReader },
      } as unknown as Response)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'not ready' }), {
          status: 404,
          headers: { 'Retry-After': '0' },
        }),
      )
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => finishedReader },
      } as unknown as Response)

    await ssePost(
      '/apps/app-1/workflows/draft/run',
      {},
      {
        workflowStreamReconnect: { initialDelayMs: 0 },
      },
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/workflow/run-accepted/events')
    expect(String(fetchMock.mock.calls[2]![0])).toContain('/workflow/run-accepted/events')
  })

  it('should keep a fresh paused snapshot subscription open without recursively dispatching pause', async () => {
    const onWorkflowPaused = vi.fn()
    const onCompleted = vi.fn()
    const snapshotReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'data: {"event":"workflow_started","workflow_run_id":"run-fresh-pause","task_id":"task-1","data":{"id":"run-fresh-pause"}}',
              '',
              'data: {"event":"workflow_paused","workflow_run_id":"run-fresh-pause","task_id":"task-1","data":{"workflow_run_id":"run-fresh-pause","paused_nodes":["human-1"],"reasons":[]}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const continuationReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 51-0',
              'data: {"event":"workflow_finished","workflow_run_id":"run-fresh-pause","data":{"id":"run-fresh-pause"}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => snapshotReader },
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => continuationReader },
      } as unknown as Response)
    let continuation: Promise<void> | undefined
    const callbacks: Parameters<typeof sseGet>[2] = {
      onCompleted,
      onWorkflowPaused: (event) => {
        onWorkflowPaused(event)
        continuation = sseGet('/workflow/run-fresh-pause/events', {}, callbacks)
      },
    }

    await sseGet('/workflow/run-fresh-pause/events', {}, callbacks)
    await continuation

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]![0])).toContain('include_state_snapshot=false')
    expect(onWorkflowPaused).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it('should wait for message_end after a restored advanced-chat answer', async () => {
    const onMessageReplace = vi.fn()
    const onMessageEnd = vi.fn()
    const onCompleted = vi.fn()
    const initialReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'data: {"event":"message_replace","workflow_run_id":"run-chat","answer":"restored answer"}',
              '',
              'data: {"event":"workflow_finished","workflow_run_id":"run-chat","data":{"id":"run-chat"}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const finalReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 61-0',
              'data: {"event":"message_end","workflow_run_id":"run-chat","id":"message-1"}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers({ 'X-Workflow-Run-ID': 'run-chat' }),
        body: { getReader: () => initialReader },
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => finalReader },
      } as unknown as Response)

    await ssePost(
      '/apps/app-1/chat-messages',
      {},
      {
        onMessageReplace,
        onMessageEnd,
        onCompleted,
        workflowStreamReconnect: { initialDelayMs: 0 },
      },
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onMessageReplace).toHaveBeenCalledTimes(1)
    expect(onMessageEnd).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it('should reconnect a trigger-debug SSE response through the shared recovery path', async () => {
    const initialReader = {
      read: vi.fn().mockRejectedValueOnce(new Error('trigger stream disconnected')),
    }
    const finalReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            [
              'id: 71-0',
              'data: {"event":"workflow_finished","workflow_run_id":"run-trigger","data":{"id":"run-trigger"}}',
              '',
            ].join('\n'),
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    const initialResponse = {
      status: 200,
      ok: true,
      headers: new Headers({ 'X-Workflow-Run-ID': 'run-trigger' }),
      body: { getReader: () => initialReader },
    } as unknown as Response
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: { getReader: () => finalReader },
    } as unknown as Response)
    const onWorkflowFinished = vi.fn()

    await handleSseResponse(
      initialResponse,
      {
        onWorkflowFinished,
        workflowStreamReconnect: { initialDelayMs: 0 },
      },
      new AbortController(),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/workflow/run-trigger/events')
    expect(onWorkflowFinished).toHaveBeenCalledTimes(1)
  })
})

describe('HTTP methods', () => {
  it('should export methods correctly', () => {
    expect(typeof get).toBe('function')
    expect(typeof post).toBe('function')
    expect(typeof put).toBe('function')
    expect(typeof patch).toBe('function')
    expect(typeof del).toBe('function')
  })
})
