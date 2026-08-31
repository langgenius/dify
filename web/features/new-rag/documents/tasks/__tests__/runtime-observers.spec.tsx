import type { DocumentProcessingTask } from '../../models'
import type { TaskRuntimeObserverContract } from '../runtime-observers'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { TaskRuntimeObservers } from '../runtime-observers'

const { observerProps } = vi.hoisted(() => ({ observerProps: vi.fn() }))

vi.mock('../event-observer', () => ({
  TaskEventObserver: (props: unknown) => {
    observerProps(props)
    return null
  },
}))

function task(id: string): DocumentProcessingTask {
  return {
    canCancel: true,
    canRetry: false,
    createdAt: '2026-07-20T10:00:00Z',
    documentId: `document-${id}`,
    documentRevision: 1,
    id,
    knowledgeSpaceId: 'space-1',
    operation: 'document_processing',
    progressPercent: 40,
    stage: 'parsed',
    state: 'running',
    taskKind: 'document',
    updatedAt: '2026-07-20T10:01:00Z',
  }
}

describe('TaskRuntimeObservers', () => {
  it('maps the opaque runtime contract into keyed event observers', () => {
    const tasks = [task('task-1'), task('task-2')]
    const contract: TaskRuntimeObserverContract = {
      eventCursors: new Map([['task-2', 'cursor-2']]),
      generation: (taskId) => (taskId === 'task-2' ? 3 : 0),
      onEvent: vi.fn(() => true),
      onEventCursorChange: vi.fn(),
      onPermissionDenied: vi.fn(),
      tasks,
      version: (current) => `${current.updatedAt}:${current.id}`,
    }

    render(<TaskRuntimeObservers knowledgeSpaceId="space-1" observers={contract} />)

    expect(observerProps).toHaveBeenCalledTimes(2)
    expect(observerProps).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        documentId: 'document-task-1',
        knowledgeSpaceId: 'space-1',
        lastEventId: undefined,
        onEvent: contract.onEvent,
        onLastEventIdChange: contract.onEventCursorChange,
        onPermissionDenied: contract.onPermissionDenied,
        taskId: 'task-1',
        taskVersion: '2026-07-20T10:01:00Z:task-1',
      }),
    )
    expect(observerProps).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        documentId: 'document-task-2',
        lastEventId: 'cursor-2',
        taskId: 'task-2',
        taskVersion: '2026-07-20T10:01:00Z:task-2',
      }),
    )
  })
})
