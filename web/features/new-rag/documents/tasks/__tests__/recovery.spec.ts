import type { KnowledgeFsBackgroundTaskResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { findBackgroundTasks } from '../recovery'

const { listBackgroundTasks } = vi.hoisted(() => ({ listBackgroundTasks: vi.fn() }))

vi.mock('@/service/console', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: { byControlSpaceId: { backgroundTasks: { get: listBackgroundTasks } } },
    },
  },
}))

const target: KnowledgeFsBackgroundTaskResponse = {
  can_cancel: false,
  can_retry: false,
  created_at: '2026-07-20T10:00:00Z',
  updated_at: '2026-07-20T10:01:00Z',
  document_id: 'document-1',
  document_revision: 1,
  id: 'target',
  knowledge_space_id: 'space-1',
  operation: 'document_processing',
  progress_completed: 1,
  progress_failed: 0,
  progress_percent: 100,
  progress_total: 1,
  state: 'completed',
  task_kind: 'document',
}

describe('background task snapshot recovery', () => {
  beforeEach(() => listBackgroundTasks.mockReset())

  it('retrieves a document task by ID without scanning history', async () => {
    listBackgroundTasks.mockResolvedValueOnce({ data: [target] })
    const tasks = await findBackgroundTasks('space-1', new Set(['target']))
    expect(tasks.get('target')).toMatchObject({ documentId: 'document-1', state: 'succeeded' })
    expect(listBackgroundTasks).toHaveBeenCalledOnce()
    expect(listBackgroundTasks).toHaveBeenCalledWith(
      { params: { control_space_id: 'space-1' }, query: { task_ids: 'target' } },
      { signal: undefined, context: { silent: true } },
    )
  })

  it('splits exact lookups into batches of at most 100 IDs', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `task-${index}`)
    listBackgroundTasks.mockResolvedValue({ data: [] })
    await findBackgroundTasks('space-1', new Set(ids))
    expect(listBackgroundTasks).toHaveBeenCalledTimes(2)
    expect(
      listBackgroundTasks.mock.calls.map(([request]) => request.query.task_ids.split(',').length),
    ).toEqual([100, 1])
  })

  it('returns no snapshot when a task is no longer visible', async () => {
    listBackgroundTasks.mockResolvedValueOnce({ data: [], next_cursor: null })
    await expect(findBackgroundTasks('space-1', new Set(['target']))).resolves.toEqual(new Map())
    expect(listBackgroundTasks).toHaveBeenCalledOnce()
  })

  it('stops before the next batch when the caller cancels recovery', async () => {
    const controller = new AbortController()
    listBackgroundTasks.mockImplementationOnce(async () => {
      controller.abort()
      return { data: [], next_cursor: 'page-2' }
    })
    await expect(
      findBackgroundTasks(
        'space-1',
        new Set(Array.from({ length: 101 }, (_, index) => `task-${index}`)),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(listBackgroundTasks).toHaveBeenCalledOnce()
  })
})
