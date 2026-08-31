import type { DocumentProcessingTask } from '../../models'
import { createTaskRuntimeState, transitionTaskRuntimeState } from '../runtime-state'

const task = (overrides: Partial<DocumentProcessingTask> = {}): DocumentProcessingTask => ({
  createdAt: '2026-07-20T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 2,
  id: 'task-1',
  knowledgeSpaceId: 'space-1',
  operation: 'document_processing',
  progressPercent: 45,
  stage: 'parsed',
  state: 'running',
  taskKind: 'document',
  updatedAt: '2026-07-20T10:01:00Z',
  ...overrides,
})

describe('document task runtime state', () => {
  it('rejects an older stream event after a newer list snapshot', () => {
    const listed = transitionTaskRuntimeState(createTaskRuntimeState(), {
      tasks: [task({ progressPercent: 80, updatedAt: '2026-07-20T10:03:00Z' })],
      type: 'list-snapshot',
    }).state

    const result = transitionTaskRuntimeState(listed, {
      event: {
        data: {
          progressPercent: 60,
          stage: 'nodes_generated',
          state: 'running',
          updatedAt: '2026-07-20T10:02:00Z',
        },
        event: 'progress',
        id: 'event-1',
      },
      taskId: 'task-1',
      taskVersion: '2026-07-20T10:02:00Z',
      type: 'stream-event',
    })

    expect(result.accepted).toBe(false)
    expect(result.state.overrides['task-1']).toBeUndefined()
  })

  it('pins terminal stream state until an authoritative list snapshot confirms it', () => {
    const listed = transitionTaskRuntimeState(createTaskRuntimeState(), {
      tasks: [task()],
      type: 'list-snapshot',
    }).state
    const terminal = transitionTaskRuntimeState(listed, {
      event: {
        data: { state: 'succeeded' },
        event: 'terminal',
        id: 'event-2',
      },
      taskId: 'task-1',
      taskVersion: '2026-07-20T10:02:00Z',
      type: 'stream-event',
    })

    expect(terminal.terminal).toEqual({
      state: 'succeeded',
      version: '2026-07-20T10:02:00Z',
    })
    expect(terminal.state.terminalPins['task-1']).toEqual({
      observedAt: '2026-07-20T10:02:00Z',
      taskListGeneration: 1,
    })
    expect(terminal.state.overrides['task-1']).toEqual(
      expect.objectContaining({ state: 'succeeded' }),
    )

    const confirmed = transitionTaskRuntimeState(terminal.state, {
      task: task({ state: 'succeeded', updatedAt: '2026-07-20T10:02:00Z' }),
      type: 'terminal-confirmed',
    }).state
    expect(confirmed.terminalPins['task-1']).toBeUndefined()
    expect(confirmed.overrides['task-1']).toBeUndefined()
  })

  it('treats an authoritative active snapshot as a retry and retires terminal state', () => {
    const terminal = transitionTaskRuntimeState(createTaskRuntimeState(), {
      event: {
        data: { state: 'failed' },
        event: 'terminal',
        id: 'event-3',
      },
      taskId: 'task-1',
      taskVersion: '2026-07-20T10:02:00Z',
      type: 'stream-event',
    }).state

    const retried = transitionTaskRuntimeState(terminal, {
      restartObserver: true,
      task: task({ updatedAt: '2026-07-20T10:03:00Z' }),
      type: 'task-snapshot',
    }).state

    expect(retried.terminalPins['task-1']).toBeUndefined()
    expect(retried.overrides['task-1']).toEqual(expect.objectContaining({ state: 'running' }))
    expect(retried.observerGenerations['task-1']).toBe(1)
  })

  it('retires a stale active stream override after the list makes the task inactive', () => {
    const listed = transitionTaskRuntimeState(createTaskRuntimeState(), {
      tasks: [task()],
      type: 'list-snapshot',
    }).state
    const streamed = transitionTaskRuntimeState(listed, {
      event: {
        data: {
          progressPercent: 60,
          stage: 'nodes_generated',
          state: 'running',
          updatedAt: '2026-07-20T10:01:00Z',
        },
        event: 'progress',
        id: 'event-4',
      },
      taskId: 'task-1',
      taskVersion: '2026-07-20T10:01:00Z',
      type: 'stream-event',
    }).state

    const inactive = transitionTaskRuntimeState(streamed, {
      taskId: 'task-1',
      type: 'task-inactive',
    }).state

    expect(inactive.streamActiveOverrideVersions.has('task-1')).toBe(false)
    expect(inactive.overrides['task-1']).toBeUndefined()
  })

  it('retains only runtime entries present in the next list snapshot', () => {
    const listed = transitionTaskRuntimeState(createTaskRuntimeState(), {
      tasks: [task(), task({ documentId: 'document-2', id: 'task-2' })],
      type: 'list-snapshot',
    }).state
    const withCursor = transitionTaskRuntimeState(listed, {
      eventId: 'event-1',
      taskId: 'task-1',
      type: 'event-cursor',
    }).state

    const pruned = transitionTaskRuntimeState(withCursor, {
      tasks: [task({ documentId: 'document-2', id: 'task-2' })],
      type: 'list-snapshot',
    }).state

    expect(pruned.currentVersions.has('task-1')).toBe(false)
    expect(pruned.eventCursors.has('task-1')).toBe(false)
  })
})
