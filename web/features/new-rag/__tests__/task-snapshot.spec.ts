import type { DocumentProcessingTask } from '../document-models'
import { effectiveDocumentTasks } from '../documents/tasks/snapshot'

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

describe('effective document task snapshots', () => {
  it('keeps a newer list snapshot over an older local override', () => {
    const result = effectiveDocumentTasks({
      baseTasks: [task({ progressPercent: 80, updatedAt: '2026-07-20T10:03:00Z' })],
      streamActiveOverrideVersions: new Map(),
      taskOverrides: {
        'task-1': { progressPercent: 60, updatedAt: '2026-07-20T10:02:00Z' },
      },
      terminalTaskPins: {},
    })

    expect(result).toEqual([
      expect.objectContaining({
        progressPercent: 80,
        updatedAt: '2026-07-20T10:03:00Z',
      }),
    ])
  })

  it('keeps a pinned terminal override until the active list snapshot catches up', () => {
    const result = effectiveDocumentTasks({
      baseTasks: [task({ updatedAt: '2026-07-20T10:02:00Z' })],
      streamActiveOverrideVersions: new Map(),
      taskOverrides: {
        'task-1': {
          progressPercent: 100,
          state: 'succeeded',
          updatedAt: '2026-07-20T10:03:00Z',
        },
      },
      terminalTaskPins: {
        'task-1': { observedAt: '2026-07-20T10:03:00Z', taskListGeneration: 4 },
      },
    })

    expect(result).toEqual([expect.objectContaining({ progressPercent: 100, state: 'succeeded' })])
  })

  it('does not let a stale stream override restore an active terminal task', () => {
    const staleStreamVersion = '2026-07-20T10:03:00Z'
    const result = effectiveDocumentTasks({
      baseTasks: [
        task({
          progressPercent: 100,
          state: 'succeeded',
          updatedAt: staleStreamVersion,
        }),
      ],
      streamActiveOverrideVersions: new Map([['task-1', staleStreamVersion]]),
      taskOverrides: {
        'task-1': {
          progressPercent: 80,
          state: 'running',
          updatedAt: staleStreamVersion,
        },
      },
      terminalTaskPins: {},
    })

    expect(result).toEqual([expect.objectContaining({ progressPercent: 100, state: 'succeeded' })])
  })
})
