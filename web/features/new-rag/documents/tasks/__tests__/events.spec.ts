import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { streamProcessingTaskEvents } from '../events'

const { listBackgroundTasks } = vi.hoisted(() => ({
  listBackgroundTasks: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          backgroundTasks: {
            get: listBackgroundTasks,
          },
        },
      },
    },
  },
}))

const task = (
  state: 'completed' | 'failed' | 'queued' | 'running',
  overrides: { documentId?: string; id?: string } = {},
) => ({
  can_cancel: state === 'queued' || state === 'running',
  can_retry: state === 'failed',
  completed_at: state === 'completed' ? '2026-07-20T01:03:00Z' : null,
  created_at: '2026-07-20T01:00:00Z',
  document_id: overrides.documentId ?? 'document/1',
  document_revision: 2,
  error_code: state === 'failed' ? 'PROCESSING_FAILED' : null,
  error_message: null,
  id: overrides.id ?? 'task/1',
  knowledge_space_id: 'space/1',
  operation: 'document_processing',
  progress_percent: state === 'completed' ? 100 : 45,
  state,
  task_kind: 'document',
  updated_at: state === 'completed' ? '2026-07-20T01:03:00Z' : '2026-07-20T01:02:03Z',
})

describe('KnowledgeFS processing task events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('polls the unified background-task endpoint until the task is terminal', async () => {
    vi.useFakeTimers()
    listBackgroundTasks
      .mockResolvedValueOnce({ data: [task('running')], next_cursor: null })
      .mockResolvedValueOnce({ data: [task('completed')], next_cursor: null })
    const abortController = new AbortController()
    const events = streamProcessingTaskEvents({
      documentId: 'document/1',
      knowledgeSpaceId: 'space/1',
      signal: abortController.signal,
      taskId: 'task/1',
    })

    await expect(events.next()).resolves.toEqual({
      done: false,
      value: {
        data: {
          progressPercent: 45,
          stage: 'parsed',
          state: 'running',
          updatedAt: '2026-07-20T01:02:03Z',
        },
        event: 'progress',
        id: '2026-07-20T01:02:03Z:running:45',
      },
    })
    const terminal = events.next()
    await vi.advanceTimersByTimeAsync(5000)
    await expect(terminal).resolves.toEqual({
      done: false,
      value: {
        data: { errorCode: undefined, state: 'succeeded' },
        event: 'terminal',
        id: '2026-07-20T01:03:00Z:succeeded:100',
      },
    })
    await expect(events.next()).resolves.toEqual({ done: true, value: undefined })
    expect(listBackgroundTasks).toHaveBeenNthCalledWith(
      1,
      {
        params: { control_space_id: 'space/1' },
        query: { limit: 100 },
      },
      expect.objectContaining({
        context: { silent: true },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('continues through cursor pages and stops when the requested task is absent', async () => {
    listBackgroundTasks
      .mockResolvedValueOnce({ data: [], next_cursor: 'next-page' })
      .mockResolvedValueOnce({ data: [], next_cursor: null })

    const events = streamProcessingTaskEvents({
      documentId: 'document-1',
      knowledgeSpaceId: 'space-1',
      taskId: 'task-1',
    })

    await expect(events.next()).resolves.toEqual({ done: true, value: undefined })
    expect(listBackgroundTasks).toHaveBeenNthCalledWith(
      2,
      {
        params: { control_space_id: 'space-1' },
        query: { cursor: 'next-page', limit: 100 },
      },
      expect.objectContaining({
        context: { silent: true },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('shares one paginated snapshot across concurrent task observers', async () => {
    listBackgroundTasks
      .mockResolvedValueOnce({
        data: [task('running', { documentId: 'document/2', id: 'task/2' })],
        next_cursor: 'next-page',
      })
      .mockResolvedValueOnce({
        data: [task('running', { documentId: 'document/1', id: 'task/1' })],
        next_cursor: null,
      })
    const firstController = new AbortController()
    const secondController = new AbortController()
    const firstEvents = streamProcessingTaskEvents({
      documentId: 'document/1',
      knowledgeSpaceId: 'space/1',
      signal: firstController.signal,
      taskId: 'task/1',
    })
    const secondEvents = streamProcessingTaskEvents({
      documentId: 'document/2',
      knowledgeSpaceId: 'space/1',
      signal: secondController.signal,
      taskId: 'task/2',
    })

    const [first, second] = await Promise.all([firstEvents.next(), secondEvents.next()])

    expect(first.done).toBe(false)
    expect(second.done).toBe(false)
    expect(listBackgroundTasks).toHaveBeenCalledTimes(2)

    firstController.abort()
    secondController.abort()
    await firstEvents.return(undefined)
    await secondEvents.return(undefined)
  })
})
