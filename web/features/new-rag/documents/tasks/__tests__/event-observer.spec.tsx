import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TaskEventObserver } from '../event-observer'

const { streamProcessingTaskEvents } = vi.hoisted(() => ({
  streamProcessingTaskEvents: vi.fn(),
}))

vi.mock('../events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../events')>()),
  streamProcessingTaskEvents,
}))

const observerProps = {
  documentId: 'document-1',
  knowledgeSpaceId: 'space-1',
  onLastEventIdChange: vi.fn(),
  onPermissionDenied: vi.fn(),
  taskId: 'task-1',
  taskVersion: '2026-07-20T10:01:00Z',
}

describe('TaskEventObserver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('keeps the latest event cursor when the observer effect restarts', async () => {
    const streamCursors: Array<string | undefined> = []
    streamProcessingTaskEvents.mockImplementation(async function* ({
      lastEventId,
    }: {
      lastEventId?: string
    }) {
      streamCursors.push(lastEventId)
      if (streamCursors.length === 1) {
        yield {
          data: {
            progressPercent: 50,
            stage: 'parsed' as const,
            state: 'running' as const,
            updatedAt: '2026-07-20T10:02:00Z',
          },
          event: 'progress' as const,
          id: 'task-1:cursor',
        }
      }
      await new Promise<void>(() => {})
    })
    const onLastEventIdChange = vi.fn()
    const rendered = render(
      <TaskEventObserver
        {...observerProps}
        onEvent={vi.fn(() => true)}
        onLastEventIdChange={onLastEventIdChange}
      />,
    )

    await act(async () => {})
    expect(onLastEventIdChange).toHaveBeenCalledWith('task-1', 'task-1:cursor')

    rendered.rerender(
      <TaskEventObserver
        {...observerProps}
        lastEventId="task-1:cursor"
        onEvent={vi.fn(() => true)}
        onLastEventIdChange={onLastEventIdChange}
      />,
    )
    await act(async () => {})

    expect(streamCursors).toEqual([undefined, 'task-1:cursor'])
  })

  it('does not retain a reconnect timer for an already-aborted observer', async () => {
    vi.useFakeTimers()
    let finishStream!: () => void
    streamProcessingTaskEvents.mockImplementation(async function* () {
      await new Promise<void>((resolve) => {
        finishStream = resolve
      })
    })
    const rendered = render(<TaskEventObserver {...observerProps} onEvent={vi.fn(() => true)} />)
    try {
      await act(async () => {})
      rendered.unmount()
      await act(async () => finishStream())

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('blocks the latest streamed task version when a reconnect loses permission', async () => {
    vi.useFakeTimers()
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) {
        yield {
          data: {
            progressPercent: 50,
            stage: 'parsed' as const,
            state: 'running' as const,
            updatedAt: '2026-07-20T10:02:00Z',
          },
          event: 'progress' as const,
          id: 'task-1:version-2',
        }
        return
      }
      throw new Response(null, { status: 403 })
    })
    const onPermissionDenied = vi.fn()
    const rendered = render(
      <TaskEventObserver
        {...observerProps}
        onEvent={vi.fn(() => true)}
        onPermissionDenied={onPermissionDenied}
      />,
    )

    try {
      await act(async () => {})
      await act(async () => vi.advanceTimersByTime(1000))

      expect(onPermissionDenied).toHaveBeenCalledWith('task-1', '2026-07-20T10:02:00Z')
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('keeps an accepted task version after rejecting a stale event before a denied reconnect', async () => {
    vi.useFakeTimers()
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) {
        for (const updatedAt of ['2026-07-20T10:02:00Z', '2026-07-20T10:00:00Z']) {
          yield {
            data: {
              progressPercent: 50,
              stage: 'parsed' as const,
              state: 'running' as const,
              updatedAt,
            },
            event: 'progress' as const,
            id: `task-1:${updatedAt}`,
          }
        }
        return
      }
      throw new Response(null, { status: 403 })
    })
    const onPermissionDenied = vi.fn()
    const rendered = render(
      <TaskEventObserver
        {...observerProps}
        onEvent={vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)}
        onPermissionDenied={onPermissionDenied}
      />,
    )

    try {
      await act(async () => {})
      await act(async () => vi.advanceTimersByTime(1000))

      expect(onPermissionDenied).toHaveBeenCalledWith('task-1', '2026-07-20T10:02:00Z')
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('syncs the newest task prop before a reconnect is denied', async () => {
    vi.useFakeTimers()
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) return
      throw new Response(null, { status: 403 })
    })
    const onPermissionDenied = vi.fn()
    const rendered = render(
      <TaskEventObserver
        {...observerProps}
        onEvent={vi.fn(() => true)}
        onPermissionDenied={onPermissionDenied}
      />,
    )

    try {
      await act(async () => {})
      rendered.rerender(
        <TaskEventObserver
          {...observerProps}
          onEvent={vi.fn(() => true)}
          onPermissionDenied={onPermissionDenied}
          taskVersion="2026-07-20T10:03:00Z"
        />,
      )
      rendered.rerender(
        <TaskEventObserver
          {...observerProps}
          onEvent={vi.fn(() => true)}
          onPermissionDenied={onPermissionDenied}
          taskVersion="2026-07-20T10:02:00Z"
        />,
      )
      await act(async () => vi.advanceTimersByTime(1000))

      expect(onPermissionDenied).toHaveBeenCalledWith('task-1', '2026-07-20T10:03:00Z')
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('uses the newest task prop for a terminal-only reconnect', async () => {
    vi.useFakeTimers()
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) return
      yield {
        data: { errorCode: 'PARSER_FAILED', state: 'failed' as const },
        event: 'terminal' as const,
        id: 'task-1:terminal',
      }
    })
    const onEvent = vi.fn(() => true)
    const rendered = render(<TaskEventObserver {...observerProps} onEvent={onEvent} />)

    try {
      await act(async () => {})
      rendered.rerender(
        <TaskEventObserver
          {...observerProps}
          onEvent={onEvent}
          taskVersion="2026-07-20T10:03:00Z"
        />,
      )
      rendered.rerender(
        <TaskEventObserver
          {...observerProps}
          onEvent={onEvent}
          taskVersion="2026-07-20T10:02:00Z"
        />,
      )
      await act(async () => vi.advanceTimersByTime(1000))

      expect(onEvent).toHaveBeenCalledWith(
        'task-1',
        '2026-07-20T10:03:00Z',
        expect.objectContaining({ event: 'terminal' }),
      )
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })
})
